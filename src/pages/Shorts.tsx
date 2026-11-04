import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, thumbUrl, videoUrl, type VideoCard } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { IconComment, IconFlag, IconMuted, IconShare, IconShorts, IconSound, IconThumbDown, IconThumbUp } from "../components/Icons";
import { ReportDialog } from "../components/ReportDialog";
import { compact, plural } from "../format";

type Detail = {
  video: VideoCard & { description: string; isShort?: boolean };
  channel: VideoCard["channel"];
  likes: number;
  dislikes: number;
  myReaction: number;
  subscribers: number;
  subscribed: boolean;
  isOwner: boolean;
};

export default function Shorts() {
  const { id } = useParams();
  const [items, setItems] = useState<VideoCard[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const startId = useRef(id);

  const loadPage = useCallback(async (p: number, first?: VideoCard) => {
    const qs = new URLSearchParams({ kind: "shorts", sort: "latest", page: String(p) });
    const data = await api<{ videos: VideoCard[]; hasMore: boolean }>(`/videos?${qs}`);
    setItems((prev) => {
      const base = p === 0 ? (first ? [first] : []) : prev ?? [];
      const seen = new Set(base.map((v) => v.id));
      return [...base, ...data.videos.filter((v) => !seen.has(v.id))];
    });
    setHasMore(data.hasMore);
    setPage(p);
  }, []);

  // Initial load: the linked Short (if any) goes first, followed by the newest Shorts.
  useEffect(() => {
    const first = startId.current;
    (async () => {
      let lead: VideoCard | undefined;
      if (first) {
        const d = await api<Detail>(`/videos/${first}`).catch(() => null);
        if (d) lead = { ...d.video, channel: d.channel, isShort: true };
      }
      await loadPage(0, lead);
    })().catch((e) => setError(e.message));
  }, [loadPage]);

  // Track which Short is on screen.
  useEffect(() => {
    const root = feed.current;
    if (!root || !items) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll(".short-slide").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  // Keep the address bar pointing at the current Short and fetch more near the end.
  useEffect(() => {
    const cur = items?.[active];
    if (!cur) return;
    window.history.replaceState(window.history.state, "", `/shorts/${cur.id}`);
    document.title = `${cur.title} · Reelroom Shorts`;
    if (hasMore && items && active >= items.length - 3) loadPage(page + 1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items?.length]);
  useEffect(() => () => void (document.title = "Reelroom"), []);

  // Arrow keys move between Shorts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const root = feed.current;
      if (root) root.scrollBy({ top: (e.key === "ArrowDown" ? 1 : -1) * root.clientHeight, behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className="empty"><h2>Couldn't load Shorts</h2><p>{error}</p></div>;
  if (!items) return <div className="page-loading"><span className="spinner" /></div>;
  if (items.length === 0) {
    return (
      <div className="empty empty-hero">
        <div className="empty-art"><IconShorts width={40} height={40} /></div>
        <h2>No Shorts yet</h2>
        <p>Upload a vertical clip and choose “Short” to start the feed.</p>
        <Link to="/upload" className="btn btn-accent">Upload a Short</Link>
      </div>
    );
  }

  return (
    <div className="shorts-feed" ref={feed}>
      {items.map((v, i) => (
        <div className="short-slide" data-i={i} key={v.id}>
          <ShortPlayer v={v} active={i === active} near={Math.abs(i - active) <= 1} muted={muted} setMuted={setMuted} />
        </div>
      ))}
    </div>
  );
}

function ShortPlayer({ v, active, near, muted, setMuted }: { v: VideoCard; active: boolean; near: boolean; muted: boolean; setMuted: (m: boolean) => void }) {
  const el = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [views, setViews] = useState(v.views);
  const [landscape, setLandscape] = useState(false);
  const { channel: me } = useAuth();
  const navigate = useNavigate();

  // Play only the Short that's on screen.
  useEffect(() => {
    const video = el.current;
    if (!video) return;
    if (active) {
      video.currentTime = 0;
      video.play().then(() => setPaused(false)).catch(() => setPaused(true));
    } else {
      video.pause();
    }
  }, [active]);

  useEffect(() => {
    if (!active || detail) return;
    api<Detail>(`/videos/${v.id}`).then(setDetail).catch(() => {});
  }, [active, detail, v.id]);

  // Real view counting, same rules as the watch page.
  const ticket = useRef<{ t: string; after: number } | null>(null);
  const viewed = useRef(false);
  const watched = useRef(0);
  const last = useRef<number | null>(null);
  const onPlay = () => {
    if (viewed.current || ticket.current) return;
    if (sessionStorage.getItem(`viewed:${v.id}`)) return void (viewed.current = true);
    api<{ ticket: string | null; after?: number }>(`/videos/${v.id}/watch`, { method: "POST" })
      .then((r) => {
        if (r.ticket) ticket.current = { t: r.ticket, after: r.after ?? 10 };
        else viewed.current = true;
      })
      .catch(() => {});
  };
  const onTimeUpdate = () => {
    const video = el.current;
    if (!video) return;
    const now = video.currentTime;
    const prev = last.current;
    last.current = now;
    if (prev !== null && !video.paused && now > prev && now - prev < 2) watched.current += now - prev;
    const tk = ticket.current;
    if (!tk || viewed.current || watched.current < tk.after) return;
    viewed.current = true;
    sessionStorage.setItem(`viewed:${v.id}`, "1");
    api<{ counted: boolean; views?: number }>(`/videos/${v.id}/view`, { json: { ticket: tk.t, watched: Math.floor(watched.current) } })
      .then((r) => r.counted && typeof r.views === "number" && setViews(r.views))
      .catch(() => {});
  };

  const togglePlay = () => {
    const video = el.current;
    if (!video) return;
    if (video.paused) video.play().then(() => setPaused(false)).catch(() => {});
    else {
      video.pause();
      setPaused(true);
    }
  };

  const needChannel = () => {
    if (me) return false;
    navigate(`/signin?next=/shorts/${v.id}`);
    return true;
  };
  const react = async (value: number) => {
    if (needChannel() || !detail) return;
    const next = detail.myReaction === value ? 0 : value;
    const r = await api(`/videos/${v.id}/reaction`, { json: { value: next } });
    setDetail({ ...detail, ...r });
  };
  const subscribe = async () => {
    if (needChannel() || !detail) return;
    const r = await api(`/channels/${detail.channel.handle}/subscribe`, { json: { on: !detail.subscribed } });
    setDetail({ ...detail, subscribed: r.subscribed, subscribers: r.subscribers });
  };
  const share = async () => {
    await navigator.clipboard?.writeText(`${location.origin}/shorts/${v.id}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="short">
      <div className="short-frame">
        <video
          ref={el}
          className={landscape ? "is-landscape" : undefined}
          onLoadedMetadata={(e) => setLandscape(e.currentTarget.videoWidth > e.currentTarget.videoHeight)}
          src={near ? videoUrl(v.id) : undefined}
          poster={v.hasThumbnail ? thumbUrl(v.id) : undefined}
          muted={muted}
          loop
          playsInline
          preload={near ? "auto" : "none"}
          onClick={togglePlay}
          onPlay={onPlay}
          onTimeUpdate={onTimeUpdate}
          onSeeking={() => (last.current = null)}
        />
        {paused && active && <button className="short-paused" onClick={togglePlay} aria-label="Play">▶</button>}
        <button className="short-mute iconbtn" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <IconMuted /> : <IconSound />}
        </button>
        <div className="short-info">
          <div className="short-channel">
            <Link to={`/c/${v.channel.handle}`}>
              <Avatar name={v.channel.name} handle={v.channel.handle} id={v.channel.id} v={v.channel.avatarVersion} frame={v.channel.frame} size={34} />
              <strong>@{v.channel.handle}</strong>
            </Link>
            {detail && !detail.isOwner && (
              <button className={`btn btn-sm ${detail.subscribed ? "btn-ghost" : "btn-light"}`} onClick={subscribe}>
                {detail.subscribed ? "Subscribed" : "Subscribe"}
              </button>
            )}
          </div>
          <p className="short-title">{v.title}</p>
          <span className="short-views">{plural(views, "view")}</span>
        </div>
      </div>
      <div className="short-actions">
        <button className={detail?.myReaction === 1 ? "on" : ""} onClick={() => react(1)} aria-label="Like">
          <span><IconThumbUp /></span>
          {detail ? compact(detail.likes) : "Like"}
        </button>
        <button className={detail?.myReaction === -1 ? "on" : ""} onClick={() => react(-1)} aria-label="Dislike">
          <span><IconThumbDown /></span>
          Dislike
        </button>
        <Link to={`/watch/${v.id}`} aria-label="Comments">
          <span><IconComment /></span>
          Comments
        </Link>
        <button onClick={share} aria-label="Share">
          <span><IconShare /></span>
          {copied ? "Copied" : "Share"}
        </button>
        {!detail?.isOwner && (
          <button onClick={() => !needChannel() && setReporting(true)} aria-label="Report">
            <span><IconFlag /></span>
            Report
          </button>
        )}
      </div>
      {reporting && <ReportDialog videoId={v.id} title={v.title} onClose={() => setReporting(false)} />}
    </div>
  );
}
