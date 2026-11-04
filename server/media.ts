import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { videos } from "../db/schema.js";
import { channelImageKey, chunkKey, currentUser, postImageKey, thumbKey } from "./shared.js";
import { mediaStore } from "./storage.js";

const notFound = () => new Response("Not found", { status: 404 });

// Serves uploaded media. Video files are stored as fixed-size chunks; each ranged request
// is answered from a single chunk, so responses stay small and the player can seek freely.
export async function serveVideo(req: Request, id: string, kind: string): Promise<Response> {
  const [video] = await db
    .select({
      status: videos.status,
      channelId: videos.channelId,
      sizeBytes: videos.sizeBytes,
      mimeType: videos.mimeType,
      chunkSize: videos.chunkSize,
      hasThumbnail: videos.hasThumbnail,
    })
    .from(videos)
    .where(eq(videos.id, id))
    .limit(1);
  if (!video) return notFound();

  if (video.status !== "ready") {
    const user = await currentUser();
    if (user?.id !== video.channelId) return notFound();
  }

  const store = mediaStore();

  if (kind === "thumb") {
    if (!video.hasThumbnail) return notFound();
    const data = await store.getBuffer(thumbKey(id));
    if (!data) return notFound();
    return new Response(data, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" },
    });
  }

  if (kind !== "video") return notFound();

  const size = video.sizeBytes;
  let start = 0;
  let end = size - 1;
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) return rangeNotSatisfiable(size);
    if (m[1] === "" && m[2] !== "") {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1] || 0);
      if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) return rangeNotSatisfiable(size);
  }

  const chunkIndex = Math.floor(start / video.chunkSize);
  const chunkStart = chunkIndex * video.chunkSize;
  end = Math.min(end, chunkStart + video.chunkSize - 1);

  const chunk = await store.getBuffer(chunkKey(id, chunkIndex));
  if (!chunk) return notFound();
  const slice = chunk.slice(start - chunkStart, end - chunkStart + 1);

  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": video.mimeType,
      "Content-Length": String(slice.byteLength),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      // private: ranged responses must not be cached by URL alone at the CDN.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function rangeNotSatisfiable(size: number) {
  return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
}

// Channel icons and banners. URLs carry ?v=<version>, so new uploads bypass old caches.
export async function serveChannelImage(id: string, kind: string): Promise<Response> {
  if (kind !== "avatar" && kind !== "banner") return notFound();
  const data = await mediaStore().getBuffer(channelImageKey(id, kind));
  if (!data) return notFound();
  return new Response(data, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}

// Images attached to community posts never change, so they cache well.
export async function servePostImage(id: string): Promise<Response> {
  const data = await mediaStore().getBuffer(postImageKey(id));
  if (!data) return notFound();
  return new Response(data, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
