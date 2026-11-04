import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Post } from "../api";
import { useAuth } from "../auth";
import { PostCard } from "../components/Posts";

// Standalone page for a single community post, so posts can be shared by link.
export default function PostPage() {
  const { id = "" } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { channel: me } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setPost(null);
    setError(null);
    api<{ post: Post }>(`/posts/${encodeURIComponent(id)}`).then((d) => setPost(d.post)).catch((e) => setError(e.message));
  }, [id, me?.id]);

  if (error) return <div className="empty"><div className="empty-art">?</div><h2>Post not found</h2><p>{error}</p><Link to="/" className="btn btn-outline">Back home</Link></div>;
  if (!post) return <div className="page-loading"><span className="spinner" /></div>;

  return (
    <div className="page">
      <div className="channel-posts single-post">
        <Link to={`/c/${post.channel.handle}?tab=posts`} className="link small">← All posts from {post.channel.name}</Link>
        <PostCard post={post} defaultOpen onDeleted={() => navigate(`/c/${post.channel.handle}?tab=posts`)} />
      </div>
    </div>
  );
}
