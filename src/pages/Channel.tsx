import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, bannerUrl, type Channel, type Post, type VideoCard } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { Ambient } from "../components/Ambient";
import { findTheme } from "../cosmetics";
import { PostComposer, PostList } from "../components/Posts";
import { ShortsShelf, VideoGrid } from "../components/VideoCard";
import { ago, hueFor, plural } from "../format";

type Data = { channel: Channel; videos: VideoCard[]; subscribers: number; subscribed: boolean; totalViews: number; isOwner: boolean };

export default function ChannelPage() {
  const { handle = "" } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { channel: me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "posts" ? "posts" : "videos";
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    setPosts(null);
    api<{ posts: Post[] }>(`/channels/${encodeURIComponent(handle)}/posts`).then((d) => setPosts(d.posts)).catch(() => setPosts([]));
  }, [handle, me?.id]);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Data>(`/channels/${encodeURIComponent(handle)}`).then(setData).catch((e) => setError(e.message));
  }, [handle, me?.id]);

  const subscribe = async () => {
    if (!me) return navigate(`/signin?next=/c/${handle}`);
    if (!data) return;
    const r = await api(`/channels/${handle}/subscribe`, { json: { on: !data.subscribed } });
    setData({ ...data, subscribed: r.subscribed, subscribers: r.subscribers });
  };

  if (error) return <div className="empty"><div className="empty-art">@</div><h2>Channel not found</h2><p>{error}</p></div>;
  if (!data) return <div className="page"><div className="skel banner" /><VideoGrid videos={[]} loading /></div>;

  const { channel: c } = data;
  const shorts = data.videos.filter((v) => v.isShort);
  const regular = data.videos.filter((v) => !v.isShort);
  const hue = hueFor(c.handle);
  const theme = findTheme(c.theme)?.id;
  return (
    <div className={`page channel ${theme ? `theme-${theme} themed-box channel-themed` : ""}`}>
      {theme && <Ambient theme={theme} contained />}
      {c.bannerVersion ? (
        <div className="banner banner-image" style={{ backgroundImage: `url("${bannerUrl(c.id, c.bannerVersion)}")` }} role="img" aria-label={`${c.name} banner`} />
      ) : (
        <div className="banner" style={{ ["--h" as string]: hue }}>
          <span className="banner-word" aria-hidden>{c.name}</span>
        </div>
      )}
      <header className="channel-head rise">
        <Avatar name={c.name} handle={c.handle} id={c.id} v={c.avatarVersion} frame={c.frame} size={112} />
        <div className="channel-id">
          <h1>{c.name}</h1>
          <p className="channel-stats">
            <b>@{c.handle}</b> <i>·</i> {plural(data.subscribers, "subscriber")} <i>·</i> {plural(data.videos.length, "video")} <i>·</i> {plural(data.totalViews, "view")}
          </p>
          {c.bio && <p className="channel-bio">{c.bio}</p>}
          <p className="muted small">Joined {ago(c.createdAt)}</p>
        </div>
        <div className="channel-cta">
          {data.isOwner ? (
            <>
              <Link to="/setup" className="btn btn-outline">Edit channel</Link>
              <Link to="/decorations" className="btn btn-ghost">✨ Decorate</Link>
              <Link to="/studio" className="btn btn-ghost">Studio</Link>
            </>
          ) : (
            <button className={`btn ${data.subscribed ? "btn-ghost subbed" : "btn-light"}`} onClick={subscribe}>
              {data.subscribed ? "Subscribed" : "Subscribe"}
            </button>
          )}
        </div>
      </header>

      <nav className="channel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "videos"} onClick={() => setParams({}, { replace: true })}>Videos</button>
        <button role="tab" aria-selected={tab === "posts"} onClick={() => setParams({ tab: "posts" }, { replace: true })}>
          Posts{posts && posts.length > 0 ? <span className="tab-count">{posts.length}</span> : null}
        </button>
      </nav>

      {tab === "posts" ? (
        <div className="channel-posts">
          {data.isOwner && <PostComposer onCreated={(p) => setPosts((l) => [p, ...(l ?? [])])} />}
          {posts === null ? (
            <p className="muted">Loading posts…</p>
          ) : posts.length === 0 ? (
            <div className="empty">
              <p>{data.isOwner ? "Share an update, a picture or a poll with your subscribers." : "This channel hasn't posted anything yet."}</p>
            </div>
          ) : (
            <PostList posts={posts} canModerate={data.isOwner} showChannel={false} onDeleted={(id) => setPosts((l) => l?.filter((p) => p.id !== id) ?? null)} />
          )}
        </div>
      ) : (
        <>
          <ShortsShelf videos={shorts} more={false} />

          {(regular.length > 0 || shorts.length === 0) && <h2 className="section-title">Videos</h2>}
          {data.videos.length === 0 ? (
            <div className="empty">
              <p>{data.isOwner ? "Your channel is ready. Time for the first upload." : "No videos here yet."}</p>
              {data.isOwner && <Link to="/upload" className="btn btn-accent">Upload a video</Link>}
            </div>
          ) : (
            regular.length > 0 && <VideoGrid videos={regular} hideChannel />
          )}
        </>
      )}
    </div>
  );
}
