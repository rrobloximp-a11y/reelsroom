import { useState } from "react";
import { thumbUrl } from "../api";
import { duration, hueFor } from "../format";

export function Thumb({ id, title, hasThumbnail, seconds }: { id: string; title: string; hasThumbnail: number; seconds?: number }) {
  const [failed, setFailed] = useState(false);
  const hue = hueFor(id);
  return (
    <div className="thumb" style={{ ["--h" as string]: hue }}>
      {hasThumbnail && !failed ? (
        <img src={thumbUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="thumb-fallback">
          <span>{title.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      {seconds ? <span className="thumb-time">{duration(seconds)}</span> : null}
    </div>
  );
}
