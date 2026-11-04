import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, postImageUrl, type Comment, type Post } from "../api";
import { useAuth } from "../auth";
import { fitImage } from "../media";
import { ago, compact, plural } from "../format";
import { Avatar } from "./Avatar";
import { IconClose, IconComment, IconImage, IconPoll, IconShare, IconThumbUp, IconTrash } from "./Icons";

const MAX_POLL = 5;

/* ---------- Composer (channel owner only) ---------- */

export function PostComposer({ onCreated }: { onCreated: (p: Post) => void }) {
  const { channel: me } = useAuth();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image]);
  if (!me) return null;

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await fitImage(file);
      setPoll(null);
      setImage({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that image.");
    }
  };

  const reset = () => {
    setText("");
    setImage(null);
    setPoll(null);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.set("body", text);
    if (image) form.set("image", image.blob, "image.jpg");
    if (poll) form.set("poll", JSON.stringify(poll.map((o) => o.trim()).filter(Boolean)));
    setBusy(true);
    try {
      const { post } = await api<{ post: Post }>("/posts", { body: form });
      onCreated(post);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't publish the post.");
    } finally {
      setBusy(false);
    }
  };

  const canPost = !busy && (text.trim() || image) && (!poll || (text.trim() && poll.filter((o) => o.trim()).length >= 2));

  return (
    <form className="post-composer rise" onSubmit={submit}>
      <div className="post-composer-head">
        <Avatar name={me.name} handle={me.handle} id={me.id} v={me.avatarVersion} frame={me.frame} size={40} />
        <span>{me.name}</span>
      </div>
      <textarea
        rows={3}
        maxLength={5000}
        placeholder={poll ? "Ask a question…" : "Share an update with your subscribers…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {image && (
        <div className="post-composer-image">
          <img src={image.url} alt="Attached" />
          <button type="button" className="iconbtn" onClick={() => setImage(null)} aria-label="Remove image"><IconClose width={18} /></button>
        </div>
      )}
      {poll && (
        <div className="post-composer-poll">
          {poll.map((opt, i) => (
            <div key={i} className="poll-edit-row">
              <input
                value={opt}
                maxLength={80}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => setPoll(poll.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {poll.length > 2 && (
                <button type="button" className="iconbtn" onClick={() => setPoll(poll.filter((_, j) => j !== i))} aria-label="Remove answer"><IconClose width={16} /></button>
              )}
            </div>
          ))}
          <div className="poll-edit-actions">
            {poll.length < MAX_POLL && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPoll([...poll, ""])}>+ Add answer</button>}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPoll(null)}>Remove poll</button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="post-composer-bar">
        <div className="post-composer-tools">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (pickImage(e.target.files?.[0]), (e.target.value = ""))} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={!!poll}>
            <IconImage width={18} /> Image
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setImage(null), setPoll(["", ""]))} disabled={!!poll}>
            <IconPoll width={18} /> Poll
          </button>
        </div>
        <div className="post-composer-tools">
          {(text || image || poll) && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Cancel</button>}
          <button className="btn btn-accent btn-sm" disabled={!canPost}>{busy ? "Posting…" : "Post"}</button>
        </div>
      </div>
    </form>
  );
}

/* ---------- Single post ---------- */

export function PostCard({ post: initial, canModerate, onDeleted, showChannel = true, defaultOpen = false }: { post: Post; canModerate?: boolean; onDeleted?: (id: string) => void; showChannel?: boolean; defaultOpen?: boolean }) {
  const [post, setPost] = useState(initial);
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const { channel: me, user } = useAuth();
  const navigate = useNavigate();
  const c = post.channel;
  const mine = me?.id === c.id;

  useEffect(() => setPost(initial), [initial]);

  const needChannel = () => {
    if (me) return false;
    navigate(user ? `/setup?next=/post/${post.id}` : `/signin?next=/post/${post.id}`);
    return true;
  };

  const like = async () => {
    if (needChannel()) return;
    const on = !post.liked;
    setPost((p) => ({ ...p, liked: on, likes: p.likes + (on ? 1 : -1) }));
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/posts/${post.id}/like`, { json: { on } });
      setPost((p) => ({ ...p, ...r }));
    } catch {
      setPost((p) => ({ ...p, liked: !on, likes: p.likes + (on ? -1 : 1) }));
    }
  };

  const vote = async (option: number) => {
    if (needChannel() || !post.poll) return;
    const next = post.poll.myVote === option ? null : option;
    try {
      const { poll } = await api<{ poll: Post["poll"] }>(`/posts/${post.id}/vote`, { json: { option: next } });
      setPost((p) => ({ ...p, poll }));
    } catch {
      /* ignore */
    }
  };

  const remove = async () => {
    if (!confirm("Delete this post?")) return;
    await api(`/posts/${post.id}`, { method: "DELETE" });
    onDeleted?.(post.id);
  };

  const share = async () => {
    await navigator.clipboard?.writeText(`${location.origin}/post/${post.id}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const totalVotes = post.poll?.options.reduce((s, o) => s + o.votes, 0) ?? 0;
  const voted = post.poll?.myVote !== null && post.poll?.myVote !== undefined;

  return (
    <article className="post rise">
      <header className="post-head">
        <Link to={`/c/${c.handle}`}><Avatar name={c.name} handle={c.handle} id={c.id} v={c.avatarVersion} frame={c.frame} size={40} /></Link>
        <div className="post-meta">
          {showChannel ? <Link to={`/c/${c.handle}`} className="post-author">{c.name}</Link> : <span className="post-author">{c.name}</span>}
          <Link to={`/post/${post.id}`} className="post-time">{ago(post.createdAt)}</Link>
        </div>
        {(mine || canModerate || me?.isAdmin) && (
          <button className="iconbtn danger" onClick={remove} aria-label="Delete post"><IconTrash width={18} /></button>
        )}
      </header>

      {post.body && <p className="post-body">{post.body}</p>}

      {post.hasImage ? (
        <a href={postImageUrl(post.id)} target="_blank" rel="noreferrer" className="post-image">
          <img src={postImageUrl(post.id)} alt="" loading="lazy" />
        </a>
      ) : null}

      {post.poll && (
        <div className="poll" role="group" aria-label="Poll">
          {post.poll.options.map((o, i) => {
            const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
            const chosen = post.poll!.myVote === i;
            return (
              <button key={i} className={`poll-option${voted ? " shown" : ""}${chosen ? " chosen" : ""}`} onClick={() => vote(i)}>
                {voted && <span className="poll-fill" style={{ width: `${pct}%` }} />}
                <span className="poll-label">{o.label}</span>
                {voted && <span className="poll-pct">{pct}%</span>}
              </button>
            );
          })}
          <p className="muted small">{plural(totalVotes, "vote")}{voted ? " · tap your answer again to undo" : ""}</p>
        </div>
      )}

      <footer className="post-actions">
        <button className={`pill${post.liked ? " on" : ""}`} onClick={like} aria-pressed={post.liked}>
          <IconThumbUp width={18} /> {post.likes ? compact(post.likes) : "Like"}
        </button>
        <button className={`pill${open ? " on" : ""}`} onClick={() => setOpen(!open)}>
          <IconComment width={18} /> {post.comments ? compact(post.comments) : "Comment"}
        </button>
        <button className="pill" onClick={share}>
          <IconShare width={18} /> {copied ? "Link copied" : "Share"}
        </button>
      </footer>

      {open && (
        <PostComments
          postId={post.id}
          canModerate={mine}
          onCount={(n) => setPost((p) => ({ ...p, comments: n }))}
        />
      )}
    </article>
  );
}

/* ---------- Comments on a post ---------- */

function PostComments({ postId, canModerate, onCount }: { postId: string; canModerate: boolean; onCount: (n: number) => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { channel: me, user } = useAuth();

  useEffect(() => {
    api<{ comments: Comment[] }>(`/posts/${postId}/comments`).then((d) => setList(d.comments)).catch(() => setList([]));
  }, [postId]);

  const update = (next: Comment[]) => {
    setList(next);
    onCount(next.length);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { comment } = await api(`/posts/${postId}/comments`, { json: { body: text } });
      update([comment, ...(list ?? [])]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api(`/post-comments/${id}`, { method: "DELETE" });
    update((list ?? []).filter((c) => c.id !== id));
  };

  return (
    <section className="post-comments">
      {me ? (
        <form className="comment-form" onSubmit={submit}>
          <Avatar name={me.name} handle={me.handle} id={me.id} v={me.avatarVersion} frame={me.frame} size={32} />
          <div>
            <textarea rows={1} maxLength={2000} placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} />
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
        <p className="muted small">
          <Link to={user ? `/setup?next=/post/${postId}` : `/signin?next=/post/${postId}`} className="link">
            {user ? "Create a channel" : "Sign in"}
          </Link>{" "}
          to comment.
        </p>
      )}
      {list === null ? (
        <p className="muted small">Loading comments…</p>
      ) : (
        <ul className="comment-list">
          {list.map((c) => (
            <li key={c.id} className="comment">
              <Link to={`/c/${c.channel.handle}`}><Avatar name={c.channel.name} handle={c.channel.handle} id={c.channel.id} v={c.channel.avatarVersion} frame={c.channel.frame} size={32} /></Link>
              <div>
                <div className="comment-head">
                  <Link to={`/c/${c.channel.handle}`}>@{c.channel.handle}</Link>
                  <span>{ago(c.createdAt)}</span>
                </div>
                <p>{c.body}</p>
              </div>
              {(me?.id === c.channel.id || canModerate || me?.isAdmin) && (
                <button className="iconbtn" onClick={() => remove(c.id)} aria-label="Delete comment"><IconTrash width={16} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- List ---------- */

export function PostList({ posts, canModerate, onDeleted, showChannel }: { posts: Post[]; canModerate?: boolean; onDeleted?: (id: string) => void; showChannel?: boolean }) {
  return (
    <div className="post-list">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} canModerate={canModerate} onDeleted={onDeleted} showChannel={showChannel} />
      ))}
    </div>
  );
}
