import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { IconFilm, IconUpload } from "../components/Icons";
import { bytes, duration } from "../format";
import { ACCEPT, MAX_BYTES, frameThumbnails, imageToThumbnail, probeVideo } from "../media";

type Stage = "pick" | "details" | "uploading" | "done";

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

export default function Upload() {
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [length, setLength] = useState(0);
  const [thumbs, setThumbs] = useState<{ blob: Blob; url: string }[]>([]);
  const [picked, setPicked] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isShort, setIsShort] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    if (stage !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!ACCEPT.includes(f.type)) return setError("Choose an MP4, WebM, MOV or OGG video.");
    if (f.size > MAX_BYTES) return setError(`That file is ${bytes(f.size)}. The limit is 500 MB.`);
    try {
      const { duration: d, el, url } = await probeVideo(f);
      setFile(f);
      setPreview(url);
      setLength(Number.isFinite(d) ? d : 0);
      // Suggest "Short" for vertical clips up to 3 minutes; the uploader can still switch.
      const tall = el.videoHeight > el.videoWidth;
      setVertical(tall);
      setIsShort(tall && Number.isFinite(d) && d <= 180);
      setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120));
      setStage("details");
      const blobs = await frameThumbnails(el, Number.isFinite(d) ? d : 1).catch(() => []);
      setThumbs(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })));
      setPicked(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const addCustom = async (f: File | undefined) => {
    if (!f) return;
    try {
      const blob = await imageToThumbnail(f);
      setThumbs((t) => [...t, { blob, url: URL.createObjectURL(blob) }]);
      setPicked(thumbs.length);
    } catch {
      setError("Couldn't use that image.");
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files[0]);
  };

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setStage("uploading");
    setProgress(0);
    try {
      const draft = await api<{ id: string; chunkSize: number; chunkCount: number }>("/studio/videos", {
        json: { title, description, mimeType: file.type, sizeBytes: file.size, durationSeconds: length, isShort },
      });
      setVideoId(draft.id);
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < draft.chunkCount) {
          const n = next++;
          const part = file.slice(n * draft.chunkSize, Math.min(file.size, (n + 1) * draft.chunkSize));
          await withRetry(() => api(`/studio/videos/${draft.id}/chunks/${n}`, { method: "PUT", body: part }));
          done++;
          setProgress(done / draft.chunkCount);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, draft.chunkCount) }, worker));
      const thumb = thumbs[picked];
      if (thumb) await withRetry(() => api(`/studio/videos/${draft.id}/thumbnail`, { method: "PUT", body: thumb.blob }));
      await withRetry(() => api(`/studio/videos/${draft.id}/publish`, { method: "POST" }));
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStage("details");
    }
  };

  const reset = () => {
    setStage("pick");
    setFile(null);
    setThumbs([]);
    setTitle("");
    setDescription("");
    setIsShort(false);
    setVertical(false);
    setVideoId(null);
    setProgress(0);
  };

  if (stage === "done" && videoId) {
    return (
      <div className="page narrow">
        <div className="empty empty-hero pop">
          <div className="empty-art reel-art done" aria-hidden><span /><span /><span /></div>
          <h2>It's live.</h2>
          <p>“{title}” is now playing on Reelroom{isShort ? " Shorts" : ""}.</p>
          <div className="row">
            <Link className="btn btn-accent" to={isShort ? `/shorts/${videoId}` : `/watch/${videoId}`}>Watch it</Link>
            <button className="btn btn-outline" onClick={reset}>Upload another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <span className="kicker">Upload</span>
        <h1>{stage === "pick" ? "Roll a new reel" : "Details"}</h1>
      </header>

      {stage === "pick" ? (
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        >
          <div className="dropzone-icon"><IconUpload width={34} height={34} /></div>
          <h2>Drop a video file here</h2>
          <p>or click to choose · MP4, WebM, MOV · up to 500 MB</p>
          <input ref={input} type="file" accept={ACCEPT.join(",")} hidden onChange={(e) => choose(e.target.files?.[0])} />
          {error && <p className="form-error">{error}</p>}
        </div>
      ) : (
        <form className="upload-grid" onSubmit={publish}>
          <div className="panel">
            <label className="field">
              <span>Title</span>
              <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={stage === "uploading"} />
              <small className="count">{title.length}/120</small>
            </label>
            <label className="field">
              <span>Description</span>
              <textarea rows={6} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={stage === "uploading"} placeholder="Tell viewers what they're about to watch" />
            </label>
            <div className="field">
              <span>Format</span>
              <div className="format-pick" role="radiogroup" aria-label="Format">
                <button type="button" role="radio" aria-checked={!isShort} className={`format-opt ${!isShort ? "on" : ""}`} onClick={() => setIsShort(false)} disabled={stage === "uploading"}>
                  <span className="format-shape format-wide" aria-hidden />
                  <strong>Video</strong>
                  <small>Regular video in the main feed</small>
                </button>
                <button type="button" role="radio" aria-checked={isShort} className={`format-opt ${isShort ? "on" : ""}`} onClick={() => setIsShort(true)} disabled={stage === "uploading"}>
                  <span className="format-shape format-tall" aria-hidden />
                  <strong>Short</strong>
                  <small>Vertical clip in the Shorts feed</small>
                </button>
              </div>
              {isShort && !vertical && <small className="muted">Tip: Shorts look best as vertical (9:16) videos.</small>}
              {isShort && length > 180 && <small className="muted">Tip: Shorts work best under 3 minutes.</small>}
            </div>
            <div className="field">
              <span>Thumbnail</span>
              <div className="thumb-picks">
                {thumbs.length === 0 && <div className="skel thumb-pick" />}
                {thumbs.map((t, i) => (
                  <button type="button" key={t.url} className={`thumb-pick ${i === picked ? "on" : ""}`} onClick={() => setPicked(i)} disabled={stage === "uploading"}>
                    <img src={t.url} alt={`Thumbnail option ${i + 1}`} />
                  </button>
                ))}
                <button type="button" className="thumb-pick thumb-add" onClick={() => customInput.current?.click()} disabled={stage === "uploading"}>
                  + Image
                </button>
                <input ref={customInput} type="file" accept="image/*" hidden onChange={(e) => addCustom(e.target.files?.[0])} />
              </div>
            </div>
            {error && <p className="form-error">{error}</p>}
            {stage === "uploading" ? (
              <div className="progress" aria-live="polite">
                <div className="progress-bar"><span style={{ transform: `scaleX(${progress})` }} /></div>
                <span className="mono">{Math.round(progress * 100)}% · don't close this tab</span>
              </div>
            ) : (
              <div className="row">
                <button className="btn btn-accent">Publish</button>
                <button type="button" className="btn btn-ghost" onClick={reset}>Choose a different file</button>
              </div>
            )}
          </div>
          <aside className="panel upload-preview">
            {preview && <video src={preview} controls muted playsInline />}
            <dl>
              <dt>Format</dt>
              <dd>{isShort ? "Short" : "Video"}</dd>
              <dt><IconFilm width={16} /> File</dt>
              <dd>{file?.name}</dd>
              <dt>Size</dt>
              <dd className="mono">{file && bytes(file.size)}</dd>
              <dt>Length</dt>
              <dd className="mono">{duration(length)}</dd>
            </dl>
          </aside>
        </form>
      )}
    </div>
  );
}
