export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Init = { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal };

export async function api<T = any>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = { "x-reelroom": "1" };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: init.signal,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export type ChannelRef = { id: string; handle: string; name: string; avatarVersion: number; frame?: string };
export type Channel = ChannelRef & { bio: string; createdAt: string; bannerVersion: number; theme?: string };
export type MyChannel = Channel & { coins: number; isAdmin: boolean; isOwner?: boolean; ownedCosmetics?: string[] };
export type CoinGift = { id: number; amount: number; message: string; createdAt: string };
export type SiteInfo = { season: string };
export type VideoCard = {
  id: string;
  title: string;
  durationSeconds: number;
  views: number;
  publishedAt: string | null;
  hasThumbnail: number;
  isShort?: boolean;
  channel: ChannelRef;
};
export type Comment = { id: number; body: string; createdAt: string; channel: ChannelRef };

export const thumbUrl = (id: string) => `/media/${id}/thumb`;
export const videoUrl = (id: string) => `/media/${id}/video`;
export const avatarUrl = (channelId: string, v: number) => `/channel-media/${channelId}/avatar?v=${v}`;
export const bannerUrl = (channelId: string, v: number) => `/channel-media/${channelId}/banner?v=${v}`;

export type PollOption = { label: string; votes: number };
export type Post = {
  id: string;
  body: string;
  hasImage: number;
  createdAt: string;
  channel: ChannelRef;
  likes: number;
  liked: boolean;
  comments: number;
  poll: { options: PollOption[]; myVote: number | null } | null;
};
export const postImageUrl = (id: string) => `/post-media/${id}`;
