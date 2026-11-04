import { Link } from "react-router-dom";
import type { VideoCard as V } from "../api";
import { ago, plural } from "../format";
import { Avatar } from "./Avatar";
import { Thumb } from "./Thumb";
import { IconShorts } from "./Icons";

export const watchPath = (v: { id: string; isShort?: boolean }) => (v.isShort ? `/shorts/${v.id}` : `/watch/${v.id}`);

export function VideoCard({ v, compact = false, hideChannel = false }: { v: V; compact?: boolean; hideChannel?: boolean }) {
  return (
    <article className={compact ? "vcard vcard-compact" : "vcard"}>
      <Link to={watchPath(v)} className="vcard-thumb" aria-label={v.title}>
        <Thumb id={v.id} title={v.title} hasThumbnail={v.hasThumbnail} seconds={v.durationSeconds} />
        {v.isShort && <span className="thumb-short"><IconShorts width={14} height={14} /> Short</span>}
      </Link>
      <div className="vcard-meta">
        {!compact && !hideChannel && (
          <Link to={`/c/${v.channel.handle}`} className="vcard-avatar">
            <Avatar name={v.channel.name} handle={v.channel.handle} id={v.channel.id} v={v.channel.avatarVersion} frame={v.channel.frame} />
          </Link>
        )}
        <div>
          <Link to={watchPath(v)} className="vcard-title">
            {v.title}
          </Link>
          {!hideChannel && (
            <Link to={`/c/${v.channel.handle}`} className="vcard-channel">
              {v.channel.name}
            </Link>
          )}
          <div className="vcard-stats">
            {plural(v.views, "view")} <i>·</i> {ago(v.publishedAt)}
          </div>
        </div>
      </div>
    </article>
  );
}

export function VideoGrid({ videos, loading, hideChannel }: { videos: V[]; loading?: boolean; hideChannel?: boolean }) {
  if (loading) {
    return (
      <div className="grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="vcard skeleton-card" key={i} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="skel skel-thumb" />
            <div className="skel skel-line" />
            <div className="skel skel-line short" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid">
      {videos.map((v, i) => (
        <div className="rise" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} key={v.id}>
          <VideoCard v={v} hideChannel={hideChannel} />
        </div>
      ))}
    </div>
  );
}

// Vertical 9:16 cards used for the Shorts shelf.
export function ShortsShelf({ videos, title = "Shorts", more = true }: { videos: V[]; title?: string; more?: boolean }) {
  if (videos.length === 0) return null;
  return (
    <section className="shorts-shelf">
      <div className="shorts-shelf-head">
        <h2 className="section-title"><IconShorts /> {title}</h2>
        {more && <Link to="/shorts" className="link">Open Shorts</Link>}
      </div>
      <div className="shorts-row">
        {videos.map((v, i) => (
          <Link to={`/shorts/${v.id}`} className="short-card rise" key={v.id} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
            <Thumb id={v.id} title={v.title} hasThumbnail={v.hasThumbnail} />
            <div className="short-card-meta">
              <strong>{v.title}</strong>
              <span>{plural(v.views, "view")}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
