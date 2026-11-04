import { hueFor } from "../format";
import { avatarUrl } from "../api";
import { findFrame } from "../cosmetics";

type Props = { name: string; handle: string; id?: string; v?: number; size?: number; src?: string; frame?: string };

export function Avatar({ name, handle, id, v, size = 36, src, frame }: Props) {
  const hue = hueFor(handle);
  const image = src ?? (id && v ? avatarUrl(id, v) : null);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const face = (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: image
          ? `center / cover no-repeat url("${image}")`
          : `linear-gradient(140deg, hsl(${hue} 62% 58%), hsl(${(hue + 40) % 360} 55% 38%))`,
      }}
      aria-hidden
    >
      {image ? null : initials || "?"}
    </span>
  );
  const f = findFrame(frame);
  if (!f) return face;
  return (
    <span className={`avatar-frame frame-${f.id}`} style={{ ["--s" as string]: `${size}px` }} aria-hidden>
      {face}
      {f.badge && <span className="frame-badge">{f.badge}</span>}
    </span>
  );
}
