import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, thumbUrl, videoUrl, type ChannelRef, type Comment, type VideoCard } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { IconFlag, IconShare, IconThumbDown, IconThumbUp, IconTrash } from "../components/Icons";
import { ReportDialog } from "../components/ReportDialog";
import { VideoCard as Card } from "../components/VideoCard";
import { ago, compact, plural } from "../format";
import { getPrefs } from "../prefs";

type Detail = {
  video: { id: string; title: string; description: string; views: number; publishedAt: string | null; hasThumbnail: number; status: string; durationSeconds: number; isShort?: boolean };
  channel: ChannelRef;
  likes: number;
  dislikes: number;
  myReaction: number;
  subscribers: number;
  subscribed: boolean;
  isOwner: boolean;
};

export default function Watch() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<VideoCard[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const viewed = useRef(false);
  const { channel: me } = useAuth();
  const navigate = useNavigate();
  const [prefs] = useState(getPrefs);

  useEffect(() => {
    setData(null);
    setError(null);
    setExpanded(false);
    viewed.current = false;
    api<Detail>(`/videos/${id}`).then(setData).catch((e) => setError(e.message));
    api<{ videos: VideoCard[] }>(`/videos?sort=popular&kind=videos&exclude=${id}`).then((d) => setNext(d.videos)).catch(() => {});
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (data) document.title = `${data.video.title} · Reelroom`;
    return () => void (document.title = "Reelroom");
  }, [data]);

  // Real view counting: get a signed ticket on first play, then redeem it once enough has actually been watched.
  const ticket = useRef<{ t: string; after: number } | null>(null);
  const watched = useRef(0);
  const lastTime = useRef<number | null>(null);
  useEffect(() => {
    ticket.current = null;
    watched.current = 0;
    lastTime.current = null;
  }, [id]);

  const onPlay = () => {
    if (viewed.current || ticket.current) return;
    if (sessionStorage.getItem(`viewed:${id}`)) return void (viewed.current = true);
    api<{ ticket: string | null; after?: number }>(`/videos/${id}/watch`, { method: "POST" })
      .then((r) => {
        if (r.ticket) ticket.current = { t: r.ticket, after: r.after ?? 30 };
        else viewed.current = true;
      })
      .catch(() => {});
  };

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const now = el.currentTime;
    const prev = lastTime.current;
    lastTime.current = now;
    // Count only normal forward playback, not seeking.
    if (prev !== null && !el.paused && now > prev && now - prev < 2) watched.current += now - prev;
    const tk = ticket.current;
    if (!tk || viewed.current || watched.current < tk.after) return;
    viewed.current = true;
    sessionStorage.setItem(`viewed:${id}`, "1");
    api<{ counted: boolean; views?: number }>(`/videos/${id}/view`, { json: { ticket: tk.t, watched: Math.floor(watched.current) } })
      .then((r) => {
        if (r.counted && typeof r.views === "number") setData((d) => (d ? { ...d, video: { ...d.video, views: r.views! } } : d));
      })
      .catch(() => {});
  };

  const needChannel = () => {
    if (!me) {
      navigate(`/signin?next=/watch/${id}`);
      return true;
    }
    return false;
  };

  const react = async (value: number) => {
    if (needChannel() || !data) return;
    const v = data.myReaction === value ? 0 : value;
    const r = await api(`/videos/${id}/reaction`, { json: { value: v } });
    setData({ ...data, ...r });
  };

  const subscribe = async () => {
    if (needChannel() || !data) return;
    const r = await api(`/channels/${data.channel.handle}/subscribe`, { json: { on: !data.subscribed } });
    setData({ ...data, subscribed: r.subscribed, subscribers: r.subscribers });
  };

  const share = async () => {
    await navigator.clipboard?.writeText(location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (error) {
    return (
      <div className="empty">
        <div className="empty-art">×</div>
        <h2>Video unavailable</h2>
        <p>{error}</p>
        <Link to="/" className="btn btn-outline">Back home</Link>
      </div>
    );
  }

  const v = data?.video;
  return (
    <div className="watch">
      {reporting && v && <ReportDialog videoId={v.id} title={v.title} onClose={() => setReporting(false)} />}
      <section className="watch-main">
        <div className={`player ${v?.isShort ? "player-short" : ""}`}>
          {v ? (
            <video
              key={v.id}
              src={videoUrl(v.id)}
              poster={v.hasThumbnail ? thumbUrl(v.id) : undefined}
              controls
              autoPlay={prefs.autoplay}
              muted={prefs.muted}
              loop={prefs.loop}
              playsInline
              preload="metadata"
              onPlay={onPlay}
              onTimeUpdate={onTimeUpdate}
              onSeeking={() => (lastTime.current = null)}
            />
          ) : (
            <div className="skel player-skel" />
          )}
        </div>

        {data && v ? (
          <div className="watch-info rise">
            {v.status !== "ready" && <p className="badge badge-warn">Draft — only you can see this</p>}
            {v.isShort && v.status === "ready" && <p><Link to={`/shorts/${v.id}`} className="badge badge-short">Short · open in Shorts</Link></p>}
            <h1 className="watch-title">{v.title}</h1>
            <div className="watch-bar">
              <Link to={`/c/${data.channel.handle}`} className="watch-channel">
                <Avatar name={data.channel.name} handle={data.channel.handle} id={data.channel.id} v={data.channel.avatarVersion} frame={data.channel.frame} size={44} />
                <div>
                  <strong>{data.channel.name}</strong>
                  <span>{plural(data.subscribers, "subscriber")}</span>
                </div>
              </Link>
              {data.isOwner ? (
                <Link to="/studio" className="btn btn-outline">Manage in Studio</Link>
              ) : (
                <button className={`btn ${data.subscribed ? "btn-ghost subbed" : "btn-light"}`} onClick={subscribe}>
                  {data.subscribed ? "Subscribed" : "Subscribe"}
                </button>
              )}
              <div className="watch-actions">
                <div className="pill-group">
                  <button className={data.myReaction === 1 ? "on" : ""} onClick={() => react(1)} aria-label="Like">
                    <IconThumbUp /> {compact(data.likes)}
                  </button>
                  <button className={data.myReaction === -1 ? "on" : ""} onClick={() => react(-1)} aria-label="Dislike">
                    <IconThumbDown /> {data.dislikes ? compact(data.dislikes) : ""}
                  </button>
                </div>
                <button className="pill" onClick={share}>
                  <IconShare /> {copied ? "Link copied" : "Share"}
                </button>
                {!data.isOwner && v.status === "ready" && (
                  <button className="pill" onClick={() => !needChannel() && setReporting(true)} title="Report an inappropriate video">
                    <IconFlag /> Report
                  </button>
                )}
              </div>
            </div>
            <div className={`description ${expanded ? "open" : ""}`} onClick={() => setExpanded(true)}>
              <div className="description-stats">
                {plural(v.views, "view")} <i>·</i> {ago(v.publishedAt)}
              </div>
              <p>{v.description || <span className="muted">No description.</span>}</p>
              {v.description.length > 180 && (
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((x) => !x);
                  }}
                >
                  {expanded ? "Show less" : "…more"}
                </button>
              )}
            </div>
            <Comments videoId={v.id} isOwner={data.isOwner} />
          </div>
        ) : (
          <div className="watch-info">
            <div className="skel skel-line" style={{ width: "60%", height: 28 }} />
            <div className="skel skel-line short" />
          </div>
        )}
      </section>

      <aside className="watch-side">
        <h3 className="side-title">Up next</h3>
        {next.length === 0 && <p className="muted">Nothing else yet.</p>}
        {next.map((n) => (
          <Card key={n.id} v={n} compact />
        ))}
      </aside>
    </div>
  );
}

function Comments({ videoId, isOwner }: { videoId: string; isOwner: boolean }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { channel: me, user } = useAuth();

  useEffect(() => {
    api<{ comments: Comment[] }>(`/videos/${videoId}/comments`).then((d) => setList(d.comments)).catch(() => setList([]));
  }, [videoId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { comment } = await api(`/videos/${videoId}/comments`, { json: { body: text } });
      setList((l) => [comment, ...(l ?? [])]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api(`/comments/${id}`, { method: "DELETE" });
    setList((l) => l?.filter((c) => c.id !== id) ?? null);
  };

  return (
    <section className="comments">
      <h3>{list ? plural(list.length, "comment") : "Comments"}</h3>
      {me ? (
        <form className="comment-form" onSubmit={submit}>
          <Avatar name={me.name} handle={me.handle} id={me.id} v={me.avatarVersion} frame={me.frame} size={38} />
          <div>
            <textarea rows={2} maxLength={2000} placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} />
            {error && <p className="form-error">{error}</p>}
            {text && (
              <div className="comment-form-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText("")}>Cancel</button>
                <button className="btn btn-accent btn-sm" disabled={busy}>Comment</button>
              </div>
            )}
          </div>
        </form>
      ) : (
        <p className="muted">
          <Link to={user ? `/setup?next=/watch/${videoId}` : `/signin?next=/watch/${videoId}`} className="link">
            {user ? "Create a channel" : "Sign in"}
          </Link>{" "}
          to join the conversation.
        </p>
      )}
      <ul className="comment-list">
        {list?.map((c) => (
          <li key={c.id} className="comment rise">
            <Link to={`/c/${c.channel.handle}`}><Avatar name={c.channel.name} handle={c.channel.handle} id={c.channel.id} v={c.channel.avatarVersion} frame={c.channel.frame} size={38} /></Link>
            <div>
              <div className="comment-head">
                <Link to={`/c/${c.channel.handle}`}>@{c.channel.handle}</Link>
                <span>{ago(c.createdAt)}</span>
              </div>
              <p>{c.body}</p>
            </div>
            {(me?.id === c.channel.id || isOwner || me?.isAdmin) && (
              <button className="iconbtn" onClick={() => remove(c.id)} aria-label="Delete comment"><IconTrash width={16} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
