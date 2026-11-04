import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ChannelRef, type Post, type VideoCard } from "../api";
import { Avatar } from "../components/Avatar";
import { PostList } from "../components/Posts";
import { VideoGrid } from "../components/VideoCard";

export default function Subscriptions() {
  const [data, setData] = useState<{ videos: VideoCard[]; channels: ChannelRef[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    api("/feed/subscriptions").then(setData).catch((e) => setError(e.message));
    api<{ posts: Post[] }>("/feed/posts").then((d) => setPosts(d.posts)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <span className="kicker">Your lineup</span>
        <h1>Subscriptions</h1>
      </header>
      {error && <div className="empty"><p>{error}</p></div>}
      {data && data.channels.length > 0 && (
        <div className="sub-strip">
          {data.channels.map((c) => (
            <Link key={c.id} to={`/c/${c.handle}`} className="sub-chip">
              <Avatar name={c.name} handle={c.handle} id={c.id} v={c.avatarVersion} frame={c.frame} size={52} />
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      )}
      {!data && !error ? (
        <VideoGrid videos={[]} loading />
      ) : data && data.videos.length === 0 ? (
        <div className="empty">
          <div className="empty-art">+</div>
          <h2>{data.channels.length ? "No uploads yet" : "You're not following anyone yet"}</h2>
          <p>Subscribe to channels and their newest videos land here.</p>
          <Link to="/trending" className="btn btn-outline">See what's trending</Link>
        </div>
      ) : data ? (
        <VideoGrid videos={data.videos} />
      ) : null}
      {posts.length > 0 && (
        <>
          <h2 className="section-title">Latest posts</h2>
          <div className="channel-posts">
            <PostList posts={posts} onDeleted={(id) => setPosts((l) => l.filter((p) => p.id !== id))} />
          </div>
        </>
      )}
    </div>
  );
}
