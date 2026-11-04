import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type VideoCard } from "../api";
import { ShortsShelf, VideoGrid } from "../components/VideoCard";
import { useAuth } from "../auth";

type Mode = "latest" | "popular" | "search";

const copy: Record<Mode, { kicker: string; title: string }> = {
  latest: { kicker: "Now showing", title: "Fresh off the reel" },
  popular: { kicker: "Trending", title: "What everyone's watching" },
  search: { kicker: "Search", title: "" },
};

export default function Home({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const q = mode === "search" ? params.get("q") ?? "" : "";
  const [videos, setVideos] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { channel } = useAuth();
  const [promoted, setPromoted] = useState<VideoCard[]>([]);
  const [shorts, setShorts] = useState<VideoCard[]>([]);
  useEffect(() => {
    if (mode === "search") return setShorts([]);
    api<{ videos: VideoCard[] }>(`/videos?kind=shorts&sort=${mode === "popular" ? "popular" : "latest"}`).then((d) => setShorts(d.videos)).catch(() => {});
  }, [mode]);
  useEffect(() => {
    if (mode !== "latest") return setPromoted([]);
    api<{ videos: VideoCard[] }>("/promoted").then((d) => setPromoted(d.videos)).catch(() => {});
  }, [mode]);

  const load = async (p: number) => {
    const qs = new URLSearchParams({ sort: mode === "popular" ? "popular" : "latest", page: String(p) });
    if (q) qs.set("q", q);
    // Home and Trending show Shorts in their own shelf; search covers everything.
    if (mode !== "search") qs.set("kind", "videos");
    const data = await api<{ videos: VideoCard[]; hasMore: boolean }>(`/videos?${qs}`);
    setVideos((prev) => (p === 0 ? data.videos : [...prev, ...data.videos]));
    setHasMore(data.hasMore);
    setPage(p);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(0)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, q]);

  const head = copy[mode];
  return (
    <div className="page">
      <header className="page-head">
        <span className="kicker">{head.kicker}</span>
        <h1>{mode === "search" ? <>Results for <em>“{q}”</em></> : head.title}</h1>
      </header>

      {promoted.length > 0 && (
        <section className="promoted">
          <h2 className="promoted-title"><span className="badge badge-promo">Promoted</span> Spotlight</h2>
          <VideoGrid videos={promoted.slice(0, 4)} />
        </section>
      )}

      {shorts.length > 0 && <ShortsShelf videos={shorts.slice(0, 12)} />}

      {error ? (
        <div className="empty"><h2>Couldn't load videos</h2><p>{error}</p></div>
      ) : !loading && videos.length === 0 && shorts.length > 0 ? null : !loading && videos.length === 0 ? (
        mode === "search" ? (
          <div className="empty">
            <div className="empty-art">?</div>
            <h2>Nothing matched</h2>
            <p>Try a different word, or browse what's new.</p>
            <Link to="/" className="btn btn-outline">Browse latest</Link>
          </div>
        ) : (
          <div className="empty empty-hero">
            <div className="empty-art reel-art" aria-hidden>
              <span /><span /><span />
            </div>
            <h2>The screen is dark — for now.</h2>
            <p>No one has uploaded yet. Be the first name on the marquee.</p>
            <Link to={channel ? "/upload" : "/setup"} className="btn btn-accent">
              {channel ? "Upload a video" : "Start your channel"}
            </Link>
          </div>
        )
      ) : (
        <>
          <VideoGrid videos={videos} loading={loading} />
          {hasMore && (
            <div className="more">
              <button className="btn btn-outline" onClick={() => load(page + 1).catch((e) => setError(e.message))}>
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
