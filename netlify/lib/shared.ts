import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { channels } from "../../db/schema.js";

// 3 MiB keeps every chunk upload and every ranged response well under the 6 MB function payload limit.
export const CHUNK_SIZE = 3 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
export const ALLOWED_MIME = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

export const mediaStore = () => getStore("media");

export const chunkKey = (videoId: string, n: number) => `videos/${videoId}/chunks/${String(n).padStart(5, "0")}`;
export const chunkPrefix = (videoId: string) => `videos/${videoId}/chunks/`;
export const thumbKey = (videoId: string) => `videos/${videoId}/thumb`;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function currentUser() {
  const user = await getUser();
  return user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in to do that.");
  return user;
}

export async function getChannelById(id: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  return c ?? null;
}

export async function requireChannel() {
  const user = await requireUser();
  const channel = await getChannelById(user.id);
  if (!channel) throw new HttpError(403, "Create your channel first.");
  if (channel.banned && !isAdminChannel(channel)) {
    throw new HttpError(403, channel.banReason ? `Your channel is banned: ${channel.banReason}` : "Your channel is banned.");
  }
  return channel;
}

export async function deleteVideoBlobs(videoId: string) {
  const store = mediaStore();
  const { blobs } = await store.list({ prefix: `videos/${videoId}/` });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
}

// The site owner's channel. Whoever owns this handle is always an admin.
export const OWNER_HANDLE = "salweqx_";
export const isAdminChannel = (c: { isAdmin: boolean; handle: string } | null) =>
  !!c && (c.isAdmin || c.handle === OWNER_HANDLE);

export async function requireAdmin() {
  const channel = await requireChannel();
  if (!isAdminChannel(channel)) throw new HttpError(403, "Admins only.");
  return channel;
}

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const channelImageKey = (channelId: string, kind: "avatar" | "banner") => `channels/${channelId}/${kind}`;

export async function deleteChannelBlobs(channelId: string, videoIds: string[]) {
  const store = mediaStore();
  await Promise.all([
    store.delete(channelImageKey(channelId, "avatar")),
    store.delete(channelImageKey(channelId, "banner")),
    ...videoIds.map(deleteVideoBlobs),
  ]);
}

export const postImageKey = (postId: string) => `posts/${postId}/image`;
