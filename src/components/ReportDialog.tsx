import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { REPORT_REASONS } from "../reports";

/** Lets a signed-in viewer flag a video as inappropriate. Admins review the reports in the Admin panel. */
export function ReportDialog({ videoId, title, onClose }: { videoId: string; title: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/videos/${videoId}/report`, { json: { reason, details } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the report.");
    } finally {
      setBusy(false);
    }
  };

  // Portal so the dialog isn't clipped by scroll containers such as the Shorts feed.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report-modal pop" role="dialog" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="report-done">
            <span className="report-done-icon" aria-hidden>✓</span>
            <h2 id="report-title">Thanks for reporting</h2>
            <p className="muted">Our team will review this video and remove it if it breaks the rules.</p>
            <button className="btn btn-accent" onClick={onClose} autoFocus>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-head">
              <div>
                <h2 id="report-title">Report video</h2>
                <p className="muted small report-video-title">“{title}”</p>
              </div>
              <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">×</button>
            </div>
            <p className="small">What's wrong with this video?</p>
            <div className="report-reasons" role="radiogroup">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className={`report-reason ${reason === r.id ? "on" : ""}`}>
                  <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                  {r.label}
                </label>
              ))}
            </div>
            <label className="field">
              <span>Details {reason === "other" ? "" : <span className="muted">(optional)</span>}</span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. what happens and at which timestamp"
                required={reason === "other"}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="row report-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-danger" disabled={!reason || busy}>{busy ? "Sending…" : "Send report"}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
