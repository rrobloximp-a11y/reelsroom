import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { IconClose, IconEdit, IconFlame, IconTrash, IconUpload } from "../components/Icons";
import { Thumb } from "../components/Thumb";
import { ago, bytes, compact } from "../format";

type Row = {
  id: string;
  title: string;
  description: string;
  status: string;
  views: number;
  durationSeconds: number;
  sizeBytes: number;
  hasThumbnail: number;
  createdAt: string;
  publishedAt: string | null;
  comments: number;
  likes: number;
  promotedUntil?: string | null;
  isShort?: boolean;
};

export default function Studio() {
  const { channel, setChannel } = useAuth();
  const [boosting, setBoosting] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subs, setSubs] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ videos: Row[] }>("/studio/videos").then((d) => setRows(d.videos)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    if (channel) api(`/channels/${channel.handle}`).then((d) => setSubs(d.subscribers)).catch(() => {});
  }, [channel]);

  const remove = async (r: Row) => {
    if (!confirm(`Delete “${r.title}”? This removes the video, its comments and likes for good.`)) return;
    setError(null);
    try {
      await api(`/studio/videos/${r.id}`, { method: "DELETE" });
      setRows((x) => x?.filter((v) => v.id !== r.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that video.");
    }
  };

  const ready = rows?.filter((r) => r.status === "ready") ?? [];
  const stats = [
    { label: "Subscribers", value: subs },
    { label: "Views", value: ready.reduce((a, r) => a + r.views, 0) },
    { label: "Likes", value: ready.reduce((a, r) => a + r.likes, 0) },
    { label: "Videos", value: ready.length },
  ];

  return (
    <div className="page">
      <header className="page-head studio-head">
        <div>
          <span className="kicker">Studio</span>
          <h1>{channel?.name}</h1>
        </div>
        <div className="studio-tools">
          <span className="coins" title="Coin balance"><span className="coin-dot" />{(channel?.coins ?? 0).toLocaleString()} coins</span>
          {channel?.isAdmin && <Link to="/admin" className="btn btn-outline">Admin</Link>}
          <Link to="/upload" className="btn btn-accent"><IconUpload /> Upload</Link>
        </div>
      </header>

      <div className="stats">
        {stats.map((s, i) => (
          <div className="stat rise" key={s.label} style={{ animationDelay: `${i * 60}ms` }}>
            <span>{s.label}</span>
            <strong>{compact(s.value)}</strong>
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        <div className="page-loading"><span className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h2>No videos yet</h2>
          <p>Your uploads and their numbers will show up here.</p>
          <Link to="/upload" className="btn btn-accent">Upload your first video</Link>
        </div>
      ) : (
        <div className="table">
          <div className="table-row table-head">
            <span>Video</span><span>Status</span><span>Views</span><span>Likes</span><span>Comments</span><span />
          </div>
          {rows.map((r) => (
            <div className="table-row" key={r.id}>
              <div className="table-video">
                <Link to={r.isShort ? `/shorts/${r.id}` : `/watch/${r.id}`}><Thumb id={r.id} title={r.title} hasThumbnail={r.hasThumbnail} seconds={r.durationSeconds} /></Link>
                <div>
                  <Link to={r.isShort ? `/shorts/${r.id}` : `/watch/${r.id}`} className="vcard-title">{r.title}</Link>
                  <span className="muted small">{bytes(r.sizeBytes)} · {r.publishedAt ? `published ${ago(r.publishedAt)}` : `started ${ago(r.createdAt)}`}</span>
                </div>
              </div>
              <span>
                {r.status === "ready" ? <span className="badge badge-ok">Public</span> : <span className="badge badge-warn">Incomplete</span>}
                {r.promotedUntil && new Date(r.promotedUntil) > new Date() && <span className="badge badge-promo">Promoted</span>}
                {r.isShort && <span className="badge badge-short">Short</span>}
              </span>
              <span className="mono" data-label="Views">{compact(r.views)}</span>
              <span className="mono" data-label="Likes">{compact(r.likes)}</span>
              <span className="mono" data-label="Comments">{compact(r.comments)}</span>
              <span className="table-actions">
                {r.status === "ready" && (
                  <button className="iconbtn" onClick={() => setBoosting(r)} aria-label="Promote" title="Promote"><IconFlame /></button>
                )}
                <button className="iconbtn" onClick={() => setEditing(r)} aria-label="Edit" title="Edit"><IconEdit /></button>
                <button className="iconbtn danger" onClick={() => remove(r)} aria-label="Delete" title="Delete"><IconTrash /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      {boosting && channel && (
        <BoostDialog
          row={boosting}
          coins={channel.coins}
          onClose={() => setBoosting(null)}
          onBought={(coins, promotedUntil) => {
            setChannel({ ...channel, coins });
            setRows((x) => x?.map((v) => (v.id === boosting.id ? { ...v, promotedUntil } : v)) ?? null);
          }}
        />
      )}

      {editing && (
        <EditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(t, d, s) => {
            setRows((x) => x?.map((v) => (v.id === editing.id ? { ...v, title: t, description: d, isShort: s } : v)) ?? null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: (t: string, d: string, isShort: boolean) => void }) {
  const [title, setTitle] = useState(row.title);
  const [isShort, setIsShort] = useState(!!row.isShort);
  const [description, setDescription] = useState(row.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/studio/videos/${row.id}`, { method: "PATCH", json: { title, description, isShort } });
      onSaved(title.trim(), description.trim(), isShort);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal pop" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Edit video</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <label className="field"><span>Title</span><input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Description</span><textarea rows={6} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="switch-row">
          <span><strong>Show as a Short</strong><small className="muted"> — appears in the Shorts feed instead of the regular video grid</small></span>
          <input type="checkbox" className="switch" checked={isShort} onChange={(e) => setIsShort(e.target.checked)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="row">
          <button className="btn btn-accent" disabled={busy}>Save</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

type Pack = { id: string; hours: number; coins: number; label: string };

function BoostDialog({ row, coins, onClose, onBought }: { row: Row; coins: number; onClose: () => void; onBought: (coins: number, promotedUntil: string) => void }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api<{ packs: Pack[] }>("/store").then((d) => setPacks(d.packs)).catch((e) => setError(e.message));
  }, []);

  const buy = async (p: Pack) => {
    setBusy(p.id);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ coins: number; promotedUntil: string }>(`/studio/videos/${row.id}/promote`, { json: { pack: p.id } });
      onBought(r.coins, r.promotedUntil);
      setDone(`Promoted until ${new Date(r.promotedUntil).toLocaleString()}. It now shows in the Promoted row on the home page.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pop" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Promote video</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <p className="muted">Spend coins to feature <b>“{row.title}”</b> at the top of the home page so real people find it.</p>
        <p><span className="coins"><span className="coin-dot" />{coins.toLocaleString()} coins available</span> · <Link to="/settings#coins" className="link">Get more</Link></p>
        {!packs ? (
          <div className="page-loading"><span className="spinner" /></div>
        ) : (
          <div className="packs">
            {packs.map((p) => (
              <button key={p.id} className="pack" disabled={!!busy || coins < p.coins} onClick={() => buy(p)}>
                <strong>{busy === p.id ? <span className="spinner" /> : p.label}</strong>
                <span>promoted</span>
                <span className="coins"><span className="coin-dot" />{p.coins.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
        {done && <p className="form-ok">{done}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
