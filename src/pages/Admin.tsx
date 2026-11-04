import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, type ChannelRef } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { IconTrash } from "../components/Icons";
import { Thumb } from "../components/Thumb";
import { ago, compact } from "../format";
import { THEMES, findTheme } from "../cosmetics";
import { reportLabel } from "../reports";

type Overview = { channels: number; videos: number; views: number; comments: number; banned: number; reported: number; revenueCents: number; currency: string };
type AdminVideo = {
  id: string;
  title: string;
  status: string;
  views: number;
  likes: number;
  bonusLikes: number;
  comments: number;
  promotedUntil: string | null;
  durationSeconds: number;
  hasThumbnail: number;
  createdAt: string;
  channel: ChannelRef & { banned: boolean };
};
type AdminChannel = ChannelRef & {
  isAdmin: boolean;
  isOwner: boolean;
  banned: boolean;
  banReason: string;
  coins: number;
  createdAt: string;
  videos: number;
  subscribers: number;
  realSubscribers: number;
  bonusSubscribers: number;
};
type AdminComment = { id: number; body: string; createdAt: string; video: { id: string; title: string }; channel: ChannelRef & { banned: boolean } };

type ReportGroup = {
  video: { id: string; title: string; views: number; status: string; isShort: boolean; durationSeconds: number; hasThumbnail: number; createdAt: string };
  channel: ChannelRef & { banned: boolean };
  lastReportedAt: string;
  reports: { id: number; reason: string; details: string; createdAt: string; reporter: { id: string; handle: string; name: string } | null }[];
};

type Tab = "reports" | "videos" | "channels" | "comments" | "events" | "emails";
const TABS: { id: Tab; label: string }[] = [
  { id: "reports", label: "🚩 Reports" },
  { id: "videos", label: "Videos" },
  { id: "channels", label: "Channels & subs" },
  { id: "comments", label: "Comments" },
  { id: "events", label: "🎁 Gifts & events" },
  { id: "emails", label: "Emails" },
];

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function Admin() {
  const { channel } = useAuth();
  const [tab, setTab] = useState<Tab>("videos");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [opened, setOpened] = useState(false);

  const loadOverview = () => api<Overview>("/admin/overview").then(setOverview).catch(() => {});
  useEffect(() => {
    if (channel?.isAdmin) loadOverview();
  }, [channel?.isAdmin]);
  // Jump straight to the Reports tab when there's something waiting for review.
  useEffect(() => {
    if (overview && !opened) {
      setOpened(true);
      if (overview.reported > 0) setTab("reports");
    }
  }, [overview, opened]);

  if (!channel?.isAdmin) return <Navigate to="/" replace />;

  const stats = [
    { label: "Channels", value: compact(overview?.channels ?? 0) },
    { label: "Videos", value: compact(overview?.videos ?? 0) },
    { label: "Total views", value: compact(overview?.views ?? 0) },
    { label: "Comments", value: compact(overview?.comments ?? 0) },
    { label: "Banned", value: compact(overview?.banned ?? 0) },
  ];

  return (
    <div className="page">
      <header className="page-head studio-head">
        <div>
          <span className="kicker">Admin</span>
          <h1>Control room</h1>
        </div>
        <Link to="/studio" className="btn btn-outline">Back to Studio</Link>
      </header>
      <div className="stats stats-5">
        {stats.map((s, i) => (
          <div className="stat rise" key={s.label} style={{ animationDelay: `${i * 60}ms` }}>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
      <div className="tabs admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "reports" && !!overview?.reported && <span className="tab-count">{overview.reported}</span>}
          </button>
        ))}
      </div>
      {tab === "reports" && <ReportsTab onChange={loadOverview} />}
      {tab === "videos" && <VideosTab />}
      {tab === "channels" && <ChannelsTab myId={channel.id} amOwner={!!(channel as { isOwner?: boolean }).isOwner} />}
      {tab === "comments" && <CommentsTab />}
      {tab === "events" && <EventsTab />}
      {tab === "emails" && <EmailsTab />}
    </div>
  );
}

function useSearch<T>(path: string, key: string, extra = "") {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = (term = q) => {
    setError(null);
    api<Record<string, T[]>>(`${path}?q=${encodeURIComponent(term)}${extra}`)
      .then((d) => setRows(d[key]))
      .catch((e) => setError(e.message));
  };
  useEffect(() => load(""), [extra]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    load();
  };
  return { q, setQ, rows, setRows, error, setError, ok, setOk, submit };
}

function SearchBar({ q, setQ, submit, placeholder, children }: { q: string; setQ: (s: string) => void; submit: (e: FormEvent) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <form className="admin-search" onSubmit={submit}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search" />
      <button className="btn btn-outline">Search</button>
      {children}
    </form>
  );
}

function NumField({ value, label, onSave }: { value: number; label: string; onSave: (n: number) => void }) {
  return (
    <input
      className="inline-num"
      type="number"
      min={0}
      defaultValue={value}
      key={value}
      aria-label={label}
      title={label}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n !== value) onSave(n);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

const isPromoted = (until: string | null) => !!until && new Date(until) > new Date();

function VideosTab() {
  const s = useSearch<AdminVideo>("/admin/videos", "videos");

  const patch = async (v: AdminVideo, changes: { views?: number; bonusLikes?: number; promoteHours?: number }, msg?: string) => {
    s.setError(null);
    s.setOk(null);
    try {
      const r = await api<{ views: number; bonusLikes: number; promotedUntil: string | null }>(`/admin/videos/${v.id}`, { method: "PATCH", json: changes });
      s.setRows((rows) => rows?.map((x) => (x.id === v.id ? { ...x, ...r } : x)) ?? null);
      if (msg) s.setOk(msg);
    } catch (e) {
      s.setError(errMsg(e, "Update failed."));
    }
  };

  const remove = async (v: AdminVideo) => {
    if (!confirm(`Delete “${v.title}” by @${v.channel.handle}? This can't be undone.`)) return;
    try {
      await api(`/admin/videos/${v.id}`, { method: "DELETE" });
      s.setRows((r) => r?.filter((x) => x.id !== v.id) ?? null);
    } catch (e) {
      s.setError(errMsg(e, "Delete failed."));
    }
  };

  return (
    <>
      <SearchBar {...s} placeholder="Search by title or channel" />
      {s.error && <p className="form-error">{s.error}</p>}
      {s.ok && <p className="form-ok">{s.ok}</p>}
      {!s.rows ? (
        <div className="page-loading"><span className="spinner" /></div>
      ) : s.rows.length === 0 ? (
        <div className="empty"><p>No videos found.</p></div>
      ) : (
        <div className="table">
          <div className="table-row table-head admin-row admin-row-videos">
            <span>Video</span><span className="admin-hide">Views</span><span className="admin-hide">Extra likes</span><span className="admin-hide">Promotion</span><span />
          </div>
          {s.rows.map((v) => (
            <div className="table-row admin-row admin-row-videos" key={v.id}>
              <div className="table-video">
                <Link to={`/watch/${v.id}`}><Thumb id={v.id} title={v.title} hasThumbnail={v.hasThumbnail} seconds={v.durationSeconds} /></Link>
                <div>
                  <Link to={`/watch/${v.id}`} className="vcard-title">{v.title}</Link>
                  <span className="muted small">
                    <Link to={`/c/${v.channel.handle}`}>@{v.channel.handle}</Link> · {ago(v.createdAt)} · {compact(v.likes + v.bonusLikes)} likes · {compact(v.comments)} comments
                  </span>
                  <span className="badges">
                    {v.status === "ready" ? <span className="badge badge-ok">Public</span> : <span className="badge badge-warn">Incomplete</span>}
                    {v.channel.banned && <span className="badge badge-danger">Banned channel</span>}
                  </span>
                </div>
              </div>
              <span className="admin-hide"><NumField value={v.views} label="Views" onSave={(n) => patch(v, { views: n })} /></span>
              <span className="admin-hide"><NumField value={v.bonusLikes} label="Extra likes" onSave={(n) => patch(v, { bonusLikes: n })} /></span>
              <span className="admin-hide promo-cell">
                {isPromoted(v.promotedUntil) ? (
                  <>
                    <span className="badge badge-promo" title={new Date(v.promotedUntil!).toLocaleString()}>until {new Date(v.promotedUntil!).toLocaleDateString()}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => patch(v, { promoteHours: 0 }, "Promotion stopped.")}>Stop</button>
                  </>
                ) : (
                  <select
                    className="inline-select"
                    value=""
                    disabled={v.status !== "ready"}
                    onChange={(e) => e.target.value && patch(v, { promoteHours: Number(e.target.value) }, `“${v.title}” is now promoted.`)}
                    aria-label="Promote"
                  >
                    <option value="">Promote…</option>
                    <option value="24">1 day</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                  </select>
                )}
              </span>
              <span className="table-actions">
                <button className="iconbtn danger" onClick={() => remove(v)} aria-label="Delete video" title="Delete video"><IconTrash /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ChannelsTab({ myId, amOwner }: { myId: string; amOwner: boolean }) {
  const [bannedOnly, setBannedOnly] = useState(false);
  const s = useSearch<AdminChannel>("/admin/channels", "channels", bannedOnly ? "&filter=banned" : "");
  const [subsFor, setSubsFor] = useState<AdminChannel | null>(null);

  const patch = async (c: AdminChannel, changes: Record<string, unknown>, msg?: string) => {
    s.setError(null);
    s.setOk(null);
    try {
      const r = await api<{ channel: Partial<AdminChannel> }>(`/admin/channels/${c.id}`, { method: "PATCH", json: changes });
      const next = { ...c, ...r.channel } as AdminChannel;
      s.setRows((rows) => rows?.map((x) => (x.id === c.id ? next : x)) ?? null);
      if (msg) s.setOk(msg);
      return next;
    } catch (e) {
      s.setError(errMsg(e, "Update failed."));
      return null;
    }
  };

  const ban = (c: AdminChannel) => {
    const reason = prompt(`Ban @${c.handle}? Their channel, videos and comments will be hidden.\n\nReason (optional):`, "");
    if (reason === null) return;
    patch(c, { banned: true, banReason: reason }, `@${c.handle} is banned.`);
  };

  const remove = async (c: AdminChannel) => {
    if (!confirm(`Delete @${c.handle} and all ${c.videos} of their videos? This can't be undone.`)) return;
    try {
      await api(`/admin/channels/${c.id}`, { method: "DELETE" });
      s.setRows((r) => r?.filter((x) => x.id !== c.id) ?? null);
    } catch (e) {
      s.setError(errMsg(e, "Delete failed."));
    }
  };

  return (
    <>
      <SearchBar {...s} placeholder="Search by name or @handle">
        <label className="check">
          <input type="checkbox" checked={bannedOnly} onChange={(e) => setBannedOnly(e.target.checked)} /> Banned only
        </label>
      </SearchBar>
      {s.error && <p className="form-error">{s.error}</p>}
      {s.ok && <p className="form-ok">{s.ok}</p>}
      {!s.rows ? (
        <div className="page-loading"><span className="spinner" /></div>
      ) : s.rows.length === 0 ? (
        <div className="empty"><p>No channels found.</p></div>
      ) : (
        <div className="table">
          <div className="table-row table-head admin-row admin-row-channels">
            <span>Channel</span><span className="admin-hide">Subscribers</span><span className="admin-hide">Coins</span><span className="admin-hide">Role</span><span />
          </div>
          {s.rows.map((c) => (
            <div className={`table-row admin-row admin-row-channels ${c.banned ? "is-banned" : ""}`} key={c.id}>
              <div className="admin-chan">
                <Avatar name={c.name} handle={c.handle} id={c.id} v={c.avatarVersion} frame={c.frame} size={40} />
                <div>
                  <Link to={`/c/${c.handle}`}>{c.name}</Link>
                  <span className="muted small">@{c.handle} · {c.videos} videos · joined {ago(c.createdAt)}</span>
                  {c.banned && <span className="badge badge-danger" title={c.banReason}>Banned{c.banReason ? `: ${c.banReason}` : ""}</span>}
                </div>
              </div>
              <span className="admin-hide subs-cell">
                <strong className="mono">{compact(c.subscribers)}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setSubsFor(c)}>+ Add subs</button>
              </span>
              <span className="admin-hide"><NumField value={c.coins} label="Coins" onSave={(n) => patch(c, { coins: n })} /></span>
              <span className="admin-hide">
                {c.isOwner ? (
                  <span className="badge badge-admin">Owner</span>
                ) : c.isAdmin ? (
                  <button className="badge badge-admin" disabled={c.id === myId || !amOwner} onClick={() => patch(c, { isAdmin: false })} title="Remove admin">Admin</button>
                ) : (
                  !c.banned && amOwner && <button className="btn btn-ghost btn-sm" onClick={() => patch(c, { isAdmin: true })}>Make admin</button>
                )}
              </span>
              <span className="table-actions">
                {c.id !== myId && !c.isOwner && (
                  <>
                    {c.banned ? (
                      <button className="btn btn-outline btn-sm" onClick={() => patch(c, { banned: false }, `@${c.handle} is unbanned.`)}>Unban</button>
                    ) : (
                      <button className="btn btn-ghost btn-sm danger-text" onClick={() => ban(c)}>Ban</button>
                    )}
                    <button className="iconbtn danger" onClick={() => remove(c)} aria-label="Delete channel" title="Delete channel"><IconTrash /></button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {subsFor && (
        <SubsDialog
          c={subsFor}
          onClose={() => setSubsFor(null)}
          onSave={async (changes, msg) => {
            const next = await patch(subsFor, changes, msg);
            if (next) setSubsFor(next);
          }}
        />
      )}
    </>
  );
}

function SubsDialog({ c, onClose, onSave }: { c: AdminChannel; onClose: () => void; onSave: (changes: Record<string, number>, msg: string) => Promise<void> }) {
  const [custom, setCustom] = useState("");
  const [extra, setExtra] = useState(String(c.bonusSubscribers));
  const [busy, setBusy] = useState(false);
  const run = async (changes: Record<string, number>, msg: string) => {
    setBusy(true);
    await onSave(changes, msg);
    setBusy(false);
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pop" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Subscribers for @{c.handle}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="subs-summary">
          <div><span className="muted small">Total shown</span><strong>{c.subscribers.toLocaleString()}</strong></div>
          <div><span className="muted small">Real</span><strong>{c.realSubscribers.toLocaleString()}</strong></div>
          <div><span className="muted small">Added by admin</span><strong>{c.bonusSubscribers.toLocaleString()}</strong></div>
        </div>
        <p className="muted small">Quick add</p>
        <div className="packs">
          {[100, 1_000, 10_000, 100_000].map((n) => (
            <button key={n} className="pack" disabled={busy} onClick={() => run({ addSubscribers: n }, `Added ${n.toLocaleString()} subscribers to @${c.handle}.`)}>
              <strong>+{compact(n)}</strong>
              <span>subs</span>
            </button>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(custom);
            if (n > 0) run({ addSubscribers: n }, `Added ${n.toLocaleString()} subscribers to @${c.handle}.`).then(() => setCustom(""));
          }}
        >
          <input type="number" min={1} placeholder="Custom amount" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn btn-accent" disabled={busy}>Add</button>
        </form>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            run({ bonusSubscribers: Number(extra) || 0 }, `Admin-added subscribers set to ${(Number(extra) || 0).toLocaleString()}.`);
          }}
        >
          <label className="field grow">
            <span>Set admin-added subscribers exactly (0 removes them)</span>
            <input type="number" min={0} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
          <button className="btn btn-outline" disabled={busy}>Save</button>
        </form>
      </div>
    </div>
  );
}

function ReportsTab({ onChange }: { onChange: () => void }) {
  const [filter, setFilter] = useState<"open" | "dismissed">("open");
  const [rows, setRows] = useState<ReportGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    api<{ reports: ReportGroup[] }>(`/admin/reports?filter=${filter}`)
      .then((d) => setRows(d.reports))
      .catch((e) => setError(errMsg(e, "Couldn't load reports.")));
  }, [filter]);

  const drop = (id: string, msg: string) => {
    setRows((r) => r?.filter((x) => x.video.id !== id) ?? null);
    setOk(msg);
    onChange();
  };

  const remove = async (g: ReportGroup) => {
    if (!confirm(`Delete “${g.video.title}” by @${g.channel.handle}? This can't be undone.`)) return;
    setError(null);
    setOk(null);
    try {
      await api(`/admin/videos/${g.video.id}`, { method: "DELETE" });
      drop(g.video.id, `“${g.video.title}” was deleted.`);
    } catch (e) {
      setError(errMsg(e, "Delete failed."));
    }
  };

  const setStatus = async (g: ReportGroup, status: "open" | "dismissed") => {
    setError(null);
    setOk(null);
    try {
      await api(`/admin/reports/${g.video.id}`, { method: "PATCH", json: { status } });
      drop(g.video.id, status === "dismissed" ? `Reports dismissed — “${g.video.title}” stays up.` : `Reports for “${g.video.title}” reopened.`);
    } catch (e) {
      setError(errMsg(e, "Update failed."));
    }
  };

  return (
    <>
      <div className="row admin-filter">
        <div className="pill-group">
          <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>Waiting for review</button>
          <button className={filter === "dismissed" ? "on" : ""} onClick={() => setFilter("dismissed")}>Dismissed</button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {ok && <p className="form-ok">{ok}</p>}
      {!rows ? (
        !error && <div className="page-loading"><span className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty"><p>{filter === "open" ? "No reported videos. All clear! 🎉" : "No dismissed reports."}</p></div>
      ) : (
        <div className="admin-reports">
          {rows.map((g) => (
            <div className="admin-report" key={g.video.id}>
              <div className="admin-report-top">
                <div className="table-video">
                  <Link to={g.video.isShort ? `/shorts/${g.video.id}` : `/watch/${g.video.id}`}>
                    <Thumb id={g.video.id} title={g.video.title} hasThumbnail={g.video.hasThumbnail} seconds={g.video.durationSeconds} />
                  </Link>
                  <div>
                    <Link to={`/watch/${g.video.id}`} className="vcard-title">{g.video.title}</Link>
                    <span className="muted small">
                      <Link to={`/c/${g.channel.handle}`}>@{g.channel.handle}</Link> · uploaded {ago(g.video.createdAt)} · {compact(g.video.views)} views
                    </span>
                    <span className="badges">
                      <span className="badge badge-danger admin-report-count">{g.reports.length} {g.reports.length === 1 ? "report" : "reports"}</span>
                      {g.video.isShort && <span className="badge badge-short">Short</span>}
                      {g.channel.banned && <span className="badge badge-danger">Banned channel</span>}
                    </span>
                  </div>
                </div>
                <div className="admin-report-actions">
                  {filter === "open" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus(g, "dismissed")} title="The video is fine — keep it">Keep video</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus(g, "open")}>Reopen</button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => remove(g)}><IconTrash width={16} height={16} /> Delete video</button>
                </div>
              </div>
              <ul className="admin-report-list">
                {g.reports.map((r) => (
                  <li key={r.id}>
                    <b>{reportLabel(r.reason)}</b>
                    <span className="muted">
                      {" "}· by {r.reporter ? <Link to={`/c/${r.reporter.handle}`}>@{r.reporter.handle}</Link> : "deleted channel"} · {ago(r.createdAt)}
                    </span>
                    {r.details && <p>{r.details}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CommentsTab() {
  const s = useSearch<AdminComment>("/admin/comments", "comments");
  const remove = async (c: AdminComment) => {
    if (!confirm("Delete this comment?")) return;
    try {
      await api(`/comments/${c.id}`, { method: "DELETE" });
      s.setRows((r) => r?.filter((x) => x.id !== c.id) ?? null);
    } catch (e) {
      s.setError(errMsg(e, "Delete failed."));
    }
  };
  return (
    <>
      <SearchBar {...s} placeholder="Search comment text, @handle or video title" />
      {s.error && <p className="form-error">{s.error}</p>}
      {!s.rows ? (
        <div className="page-loading"><span className="spinner" /></div>
      ) : s.rows.length === 0 ? (
        <div className="empty"><p>No comments found.</p></div>
      ) : (
        <div className="admin-comments">
          {s.rows.map((c) => (
            <div className="admin-comment" key={c.id}>
              <Avatar name={c.channel.name} handle={c.channel.handle} id={c.channel.id} v={c.channel.avatarVersion} frame={c.channel.frame} size={36} />
              <div>
                <p className="small">
                  <Link to={`/c/${c.channel.handle}`}><b>@{c.channel.handle}</b></Link>
                  {c.channel.banned && <span className="badge badge-danger">Banned</span>}
                  <span className="muted"> on </span>
                  <Link to={`/watch/${c.video.id}`} className="link">{c.video.title}</Link>
                  <span className="muted"> · {ago(c.createdAt)}</span>
                </p>
                <p className="admin-comment-body">{c.body}</p>
              </div>
              <button className="iconbtn danger" onClick={() => remove(c)} aria-label="Delete comment" title="Delete comment"><IconTrash /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const TEMPLATES = [
  { file: "confirmation", label: "Confirm signup" },
  { file: "recovery", label: "Reset password" },
  { file: "email-change", label: "Confirm new email" },
  { file: "invitation", label: "Invitation" },
];

function EmailsTab() {
  const [email, setEmail] = useState("rrobloximp@gmail.com");
  const [kind, setKind] = useState<"confirmation" | "recovery">("confirmation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [preview, setPreview] = useState(TEMPLATES[0].file);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api("/admin/test-email", { json: { email, kind } });
      setOk(`Sent a ${kind === "recovery" ? "password reset" : "verification"} email to ${email}. Check the inbox (and the spam folder).`);
    } catch (err) {
      setError(errMsg(err, "Couldn't send the email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="emails-tab">
      <form className="panel" onSubmit={send}>
        <h2>Send a test email</h2>
        <p className="muted small">Sends a real Reelroom email so you can see the design in an inbox.</p>
        <label className="field">
          <span>Send to</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="seg">
          <button type="button" className={kind === "confirmation" ? "active" : ""} onClick={() => setKind("confirmation")}>Verification</button>
          <button type="button" className={kind === "recovery" ? "active" : ""} onClick={() => setKind("recovery")}>Password reset</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
        <button className="btn btn-accent" disabled={busy}>{busy ? <span className="spinner" /> : "Send email"}</button>
        <p className="muted small">
          A verification email only works for an address that doesn't have a confirmed account yet. For an existing account, send a password reset.
        </p>
      </form>
      <section className="panel">
        <h2>Email designs</h2>
        <div className="seg seg-wrap">
          {TEMPLATES.map((t) => (
            <button type="button" key={t.file} className={preview === t.file ? "active" : ""} onClick={() => setPreview(t.file)}>{t.label}</button>
          ))}
        </div>
        <iframe className="email-preview" title="Email preview" src={`/emails/${preview}.html`} sandbox="" />
        <p className="muted small">Template file: <code>/emails/{preview}.html</code></p>
      </section>
    </div>
  );
}

type Gift = { id: number; amount: number; message: string; recipients: number; createdAt: string; by: { handle: string; name: string } | null };

const GIFT_PRESETS = [
  { label: "🎄 Christmas", amount: 500, message: "Merry Christmas from Reelroom! 🎄 Wesołych Świąt!" },
  { label: "🎆 New Year", amount: 300, message: "Happy New Year! 🎆 Szczęśliwego Nowego Roku!" },
  { label: "🎉 Thank you", amount: 100, message: "Thanks for being part of Reelroom!" },
];

function EventsTab() {
  const { site, setSite, refresh } = useAuth();
  const [amount, setAmount] = useState(500);
  const [message, setMessage] = useState(GIFT_PRESETS[0].message);
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [seasonMsg, setSeasonMsg] = useState<string | null>(null);

  const load = () => api<{ gifts: Gift[] }>("/admin/gifts").then((d) => setGifts(d.gifts)).catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm(`Give ${amount.toLocaleString("en-US")} coins to every channel that isn't banned?`)) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { gift } = await api<{ gift: Gift }>("/admin/gifts", { json: { amount, message } });
      setOk(`Sent ${gift.amount.toLocaleString("en-US")} coins to ${gift.recipients.toLocaleString("en-US")} channels. They'll see a present pop-up next time they open Reelroom.`);
      void load();
      void refresh();
    } catch (err) {
      setError(errMsg(err, "Couldn't send the gift."));
    } finally {
      setBusy(false);
    }
  };

  const setSeason = async (season: string) => {
    setSeasonMsg(null);
    try {
      await api("/admin/season", { method: "PUT", json: { season } });
      setSite({ ...site, season });
      setSeasonMsg(season ? `Everyone on "Seasonal" background now sees ${findTheme(season)?.name}.` : "Seasonal theme turned off.");
    } catch (err) {
      setSeasonMsg(errMsg(err, "Couldn't change the theme."));
    }
  };

  return (
    <div className="emails-tab">
      <form className="panel" onSubmit={send}>
        <h2>Gift coins to everyone</h2>
        <p className="muted small">Every channel that isn't banned gets the same number of coins, plus a present pop-up with your message.</p>
        <div className="seg seg-wrap">
          {GIFT_PRESETS.map((p) => (
            <button type="button" key={p.label} onClick={() => { setAmount(p.amount); setMessage(p.message); }}>{p.label}</button>
          ))}
        </div>
        <label className="field">
          <span>Coins per channel</span>
          <input type="number" min={1} max={1000000} required value={amount} onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value))))} />
        </label>
        <div className="row">
          {[50, 100, 250, 500, 1000, 5000].map((n) => (
            <button type="button" key={n} className={`pill ${amount === n ? "active" : ""}`} onClick={() => setAmount(n)}>{n.toLocaleString("en-US")}</button>
          ))}
        </div>
        <label className="field">
          <span>Message (optional)</span>
          <input maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Merry Christmas!" />
        </label>
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
        <button className="btn btn-accent" disabled={busy || amount < 1}>{busy ? <span className="spinner" /> : `🎁 Send ${amount.toLocaleString("en-US")} coins to everyone`}</button>

        <h3 className="gift-history-title">Past gifts</h3>
        {gifts === null ? (
          <p className="muted small">Loading…</p>
        ) : gifts.length === 0 ? (
          <p className="muted small">No gifts sent yet.</p>
        ) : (
          <ul className="gift-history">
            {gifts.map((g) => (
              <li key={g.id}>
                <strong>🪙 {g.amount.toLocaleString("en-US")}</strong>
                <span>{g.message || <span className="muted">No message</span>}</span>
                <span className="muted small">
                  {g.recipients.toLocaleString("en-US")} channels · {ago(g.createdAt)}{g.by ? ` · by @${g.by.handle}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>

      <section className="panel">
        <h2>Seasonal theme</h2>
        <p className="muted small">
          The background everyone sees unless they've picked their own. Turn on Christmas in December for snow across the whole site.
        </p>
        <div className="deco-grid deco-grid-site">
          <button className={`deco-site ${!site.season ? "is-on" : ""}`} onClick={() => setSeason("")}>
            <span className="deco-swatch" style={{ background: "linear-gradient(160deg,#15110e,#2b241e 60%,#ef5f3c)" }} />
            <strong>Off (classic)</strong>
          </button>
          {THEMES.map((t) => (
            <button key={t.id} className={`deco-site ${site.season === t.id ? "is-on" : ""}`} onClick={() => setSeason(t.id)}>
              <span className="deco-swatch" style={{ background: t.swatch }} />
              <strong>{t.name}</strong>
            </button>
          ))}
        </div>
        {seasonMsg && <p className="form-ok">{seasonMsg}</p>}
      </section>
    </div>
  );
}
