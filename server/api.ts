import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, ilike, inArray, ne, or, sql, count, type SQL } from "drizzle-orm";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getIdentityConfig } from "@netlify/identity";
import { db } from "../../db/index.js";
import { channels, coinGifts, coinPurchases, siteSettings, comments, postComments, postLikes, postVotes, posts, reactions, subscriptions, videoReports, videoViews, videos } from "../../db/schema.js";
import { REPORT_REASONS } from "../../src/reports.js";
import {
  ALLOWED_MIME,
  CHUNK_SIZE,
  HttpError,
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  MAX_VIDEO_BYTES,
  OWNER_HANDLE,
  channelImageKey,
  deleteChannelBlobs,
  isAdminChannel,
  requireAdmin,
  chunkKey,
  chunkPrefix,
  currentUser,
  deleteVideoBlobs,
  getChannelById,
  json,
  mediaStore,
  postImageKey,
  requireChannel,
  requireUser,
  thumbKey,
} from "../lib/shared.js";
import { THEMES, findCosmetic, findFrame, findTheme } from "../../src/cosmetics.js";

type Handler = (req: Request, params: Record<string, string>, url: URL, context: Context) => Promise<Response>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$",
  );
  routes.push({ method, pattern, keys, handler });
}

const newId = () => randomBytes(8).toString("base64url");
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const HANDLE_RE = /^[a-z0-9_.-]{3,30}$/;

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

function channelRef() {
  return { id: channels.id, handle: channels.handle, name: channels.name, avatarVersion: channels.avatarVersion, frame: channels.frame };
}

// Columns returned for every video card.
const cardColumns = {
  id: videos.id,
  title: videos.title,
  durationSeconds: videos.durationSeconds,
  views: videos.views,
  publishedAt: videos.publishedAt,
  hasThumbnail: videos.hasThumbnail,
  promotedUntil: videos.promotedUntil,
  isShort: videos.isShort,
  channel: channelRef(),
};

type ChannelRow = typeof channels.$inferSelect;

// Public view of a channel: never expose the coin balance or admin flag to other people.
function publicChannel(c: ChannelRow) {
  return {
    id: c.id,
    handle: c.handle,
    name: c.name,
    bio: c.bio,
    createdAt: c.createdAt,
    avatarVersion: c.avatarVersion,
    bannerVersion: c.bannerVersion,
    frame: c.frame,
    theme: c.theme,
  };
}

const readyOnly = eq(videos.status, "ready");
// Public listings hide unfinished uploads and videos from banned channels (queries must join channels).
const publicOnly = and(readyOnly, eq(channels.banned, false))!;

async function likeTally(id: string) {
  const [t] = await db
    .select({
      likes: sql<number>`(count(*) filter (where ${reactions.value} = 1))::int`,
      dislikes: sql<number>`(count(*) filter (where ${reactions.value} = -1))::int`,
    })
    .from(reactions)
    .where(eq(reactions.videoId, id));
  const [v] = await db.select({ bonus: videos.bonusLikes }).from(videos).where(eq(videos.id, id));
  return { likes: (t?.likes ?? 0) + (v?.bonus ?? 0), dislikes: t?.dislikes ?? 0 };
}

async function subscriberCount(channelId: string) {
  const [[r], [c]] = await Promise.all([
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.channelId, channelId)),
    db.select({ bonus: channels.bonusSubscribers }).from(channels).where(eq(channels.id, channelId)),
  ]);
  return (r?.n ?? 0) + (c?.bonus ?? 0);
}

async function isSubscribed(subscriberId: string | undefined, channelId: string) {
  if (!subscriberId) return false;
  const [r] = await db
    .select({ n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriberId, subscriberId), eq(subscriptions.channelId, channelId)));
  return (r?.n ?? 0) > 0;
}

async function ownVideo(id: string) {
  const channel = await requireChannel();
  const [video] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!video) throw new HttpError(404, "Video not found.");
  if (video.channelId !== channel.id) throw new HttpError(403, "That video isn't yours.");
  return { channel, video };
}

/* ---------- Me / channel setup ---------- */

// The signed-in user's own channel, including private fields.
function myChannel(c: ChannelRow) {
  const admin = isAdminChannel(c);
  return {
    ...publicChannel(c),
    coins: c.coins,
    isAdmin: admin,
    isOwner: c.handle === OWNER_HANDLE,
    banned: c.banned && !admin,
    banReason: c.banReason,
    ownedCosmetics: c.ownedCosmetics ?? [],
  };
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, key)).limit(1);
  return row ? (row.value as T) : fallback;
}

async function siteInfo() {
  const season = await getSetting<string>("season", "");
  return { season: findTheme(season) ? season : "" };
}

// Coin gifts sent after this channel was created that it hasn't been shown yet.
async function unseenGifts(c: ChannelRow) {
  return db
    .select({ id: coinGifts.id, amount: coinGifts.amount, message: coinGifts.message, createdAt: coinGifts.createdAt })
    .from(coinGifts)
    .where(and(sql`${coinGifts.id} > ${c.seenGiftId}`, sql`${coinGifts.createdAt} >= ${c.createdAt}`))
    .orderBy(desc(coinGifts.id))
    .limit(10);
}

route("POST", "/me/gifts/seen", async (req) => {
  const me = await requireChannel();
  const { id } = await body<{ id?: number }>(req);
  const upTo = Math.floor(Number(id));
  if (!Number.isFinite(upTo) || upTo < 0) throw new HttpError(422, "Invalid gift.");
  await db
    .update(channels)
    .set({ seenGiftId: sql`greatest(${channels.seenGiftId}, ${upTo})` })
    .where(eq(channels.id, me.id));
  return json({ ok: true });
});

/* ---------- Decorations ---------- */

route("POST", "/me/decorations/buy", async (req) => {
  const me = await requireChannel();
  const { id } = await body<{ id?: string }>(req);
  const item = findCosmetic(String(id ?? ""));
  if (!item) throw new HttpError(404, "That decoration doesn't exist.");
  if (item.price === 0 || isAdminChannel(me)) throw new HttpError(422, "This one is already yours — just put it on.");
  if ((me.ownedCosmetics ?? []).includes(item.id)) throw new HttpError(409, "You already own this.");
  const asJson = JSON.stringify([item.id]);
  const [c] = await db
    .update(channels)
    .set({
      coins: sql`${channels.coins} - ${item.price}`,
      ownedCosmetics: sql`${channels.ownedCosmetics} || ${asJson}::jsonb`,
    })
    .where(
      and(
        eq(channels.id, me.id),
        sql`${channels.coins} >= ${item.price}`,
        sql`not (${channels.ownedCosmetics} @> ${asJson}::jsonb)`,
      ),
    )
    .returning();
  if (!c) throw new HttpError(402, `You need ${item.price.toLocaleString("en-US")} coins for this.`);
  return json({ channel: myChannel(c) });
});

route("PATCH", "/me/decorations", async (req) => {
  const me = await requireChannel();
  const input = await body<{ frame?: string; theme?: string }>(req);
  const owns = (id: string) => {
    const item = findCosmetic(id);
    if (!item) throw new HttpError(404, "That decoration doesn't exist.");
    if (item.price > 0 && !isAdminChannel(me) && !(me.ownedCosmetics ?? []).includes(id)) {
      throw new HttpError(402, `Buy "${item.name}" first.`);
    }
  };
  const set: Partial<ChannelRow> = {};
  if (input.frame !== undefined) {
    const f = String(input.frame);
    if (f && !findFrame(f)) throw new HttpError(404, "Unknown frame.");
    if (f) owns(f);
    set.frame = f;
  }
  if (input.theme !== undefined) {
    const t = String(input.theme);
    if (t && !findTheme(t)) throw new HttpError(404, "Unknown background.");
    if (t) owns(t);
    set.theme = t;
  }
  if (!Object.keys(set).length) throw new HttpError(422, "Nothing to change.");
  const [c] = await db.update(channels).set(set).where(eq(channels.id, me.id)).returning();
  return json({ channel: myChannel(c) });
});

route("GET", "/me", async () => {
  const [user, site] = await Promise.all([currentUser(), siteInfo()]);
  if (!user) return json({ user: null, channel: null, site, gifts: [] });
  const channel = await getChannelById(user.id);
  const gifts = channel ? await unseenGifts(channel) : [];
  return json({
    user: { id: user.id, email: user.email, name: user.name },
    channel: channel ? myChannel(channel) : null,
    site,
    gifts,
  });
});

route("POST", "/me/channel", async (req) => {
  const user = await requireUser();
  const existing = await getChannelById(user.id);
  if (existing?.banned && !isAdminChannel(existing)) throw new HttpError(403, "Your channel is banned.");
  const input = await body(req);
  const handle = clean(input.handle, 30).toLowerCase().replace(/^@/, "");
  const name = clean(input.name, 60);
  const bio = clean(input.bio, 1000);
  if (!HANDLE_RE.test(handle)) throw new HttpError(422, "Handles are 3–30 characters: letters, numbers, _ . -");
  if (!name) throw new HttpError(422, "Give your channel a name.");

  const [taken] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.handle, handle), ne(channels.id, user.id)))
    .limit(1);
  if (taken) throw new HttpError(409, "That handle is already taken.");

  const owner = handle === OWNER_HANDLE;
  const [channel] = await db
    .insert(channels)
    .values({ id: user.id, handle, name, bio, isAdmin: owner })
    .onConflictDoUpdate({ target: channels.id, set: { handle, name, bio, ...(owner ? { isAdmin: true } : {}) } })
    .returning();
  return json({ channel: myChannel(channel) });
});

// Channel icon and banner. The browser crops and converts them to JPEG before upload.
for (const kind of ["avatar", "banner"] as const) {
  const column = kind === "avatar" ? "avatarVersion" : "bannerVersion";
  route("PUT", `/me/${kind}`, async (req) => {
    const me = await requireChannel();
    const data = await req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) throw new HttpError(422, "Images must be under 4 MB.");
    await mediaStore().set(channelImageKey(me.id, kind), data);
    const [c] = await db
      .update(channels)
      .set({ [column]: sql`${channels[column]} + 1` })
      .where(eq(channels.id, me.id))
      .returning();
    return json({ channel: myChannel(c) });
  });
  route("DELETE", `/me/${kind}`, async () => {
    const me = await requireChannel();
    await mediaStore().delete(channelImageKey(me.id, kind));
    const [c] = await db.update(channels).set({ [column]: 0 }).where(eq(channels.id, me.id)).returning();
    return json({ channel: myChannel(c) });
  });
}

/* ---------- Browsing ---------- */

route("GET", "/videos", async (_req, _p, url) => {
  const q = clean(url.searchParams.get("q"), 100);
  const sort = url.searchParams.get("sort") === "popular" ? "popular" : "latest";
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  const exclude = url.searchParams.get("exclude");
  const limit = 24;

  const conds = [publicOnly];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    conds.push(or(ilike(videos.title, like), ilike(videos.description, like), ilike(channels.name, like))!);
  }
  if (exclude) conds.push(ne(videos.id, exclude));
  // kind=shorts → only Shorts, kind=videos → only regular videos, anything else → both.
  const kind = url.searchParams.get("kind");
  if (kind === "shorts") conds.push(eq(videos.isShort, true));
  else if (kind === "videos") conds.push(eq(videos.isShort, false));

  const rows = await db
    .select(cardColumns)
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(and(...conds))
    .orderBy(sort === "popular" ? desc(videos.views) : desc(videos.publishedAt), desc(videos.createdAt))
    .limit(limit + 1)
    .offset(page * limit);

  return json({ videos: rows.slice(0, limit), hasMore: rows.length > limit });
});

route("GET", "/feed/subscriptions", async () => {
  const channel = await requireChannel();
  const subs = db
    .select({ id: subscriptions.channelId })
    .from(subscriptions)
    .where(eq(subscriptions.subscriberId, channel.id));
  const rows = await db
    .select(cardColumns)
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(and(publicOnly, inArray(videos.channelId, subs)))
    .orderBy(desc(videos.publishedAt))
    .limit(60);
  const following = await db
    .select(channelRef())
    .from(subscriptions)
    .innerJoin(channels, eq(subscriptions.channelId, channels.id))
    .where(eq(subscriptions.subscriberId, channel.id))
    .orderBy(channels.name);
  return json({ videos: rows, channels: following });
});

route("GET", "/channels/:handle", async (_req, { handle }) => {
  const [channel] = await db.select().from(channels).where(eq(channels.handle, handle.toLowerCase())).limit(1);
  if (!channel) throw new HttpError(404, "Channel not found.");
  const user = await currentUser();
  if (channel.banned && user?.id !== channel.id) {
    const viewer = user ? await getChannelById(user.id) : null;
    if (!isAdminChannel(viewer)) throw new HttpError(404, "This channel isn't available.");
  }
  const [list, subs, subscribed, totals] = await Promise.all([
    db
      .select(cardColumns)
      .from(videos)
      .innerJoin(channels, eq(videos.channelId, channels.id))
      .where(and(readyOnly, eq(videos.channelId, channel.id)))
      .orderBy(desc(videos.publishedAt)),
    subscriberCount(channel.id),
    isSubscribed(user?.id, channel.id),
    db
      .select({ views: sql<number>`coalesce(sum(${videos.views}), 0)::int` })
      .from(videos)
      .where(and(readyOnly, eq(videos.channelId, channel.id))),
  ]);
  return json({
    channel: publicChannel(channel),
    videos: list,
    subscribers: subs,
    subscribed,
    totalViews: totals[0]?.views ?? 0,
    isOwner: user?.id === channel.id,
  });
});

route("POST", "/channels/:handle/subscribe", async (req, { handle }) => {
  const me = await requireChannel();
  const { on } = await body<{ on?: boolean }>(req);
  const [target] = await db.select().from(channels).where(eq(channels.handle, handle.toLowerCase())).limit(1);
  if (!target) throw new HttpError(404, "Channel not found.");
  if (target.id === me.id) throw new HttpError(422, "You can't subscribe to yourself.");
  if (on) {
    await db.insert(subscriptions).values({ subscriberId: me.id, channelId: target.id }).onConflictDoNothing();
  } else {
    await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.subscriberId, me.id), eq(subscriptions.channelId, target.id)));
  }
  return json({ subscribed: !!on, subscribers: await subscriberCount(target.id) });
});

/* ---------- Single video ---------- */

route("GET", "/videos/:id", async (_req, { id }) => {
  const [row] = await db
    .select({ video: videos, channel: channels })
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(eq(videos.id, id))
    .limit(1);
  const user = await currentUser();
  if (!row || (row.video.status !== "ready" && row.video.channelId !== user?.id)) {
    throw new HttpError(404, "Video not found.");
  }
  if (row.channel.banned && row.channel.id !== user?.id) {
    const viewer = user ? await getChannelById(user.id) : null;
    if (!isAdminChannel(viewer)) throw new HttpError(404, "This video isn't available.");
  }
  const [tally, mine, subs, subscribed] = await Promise.all([
    likeTally(id),
    user
      ? db
          .select({ value: reactions.value })
          .from(reactions)
          .where(and(eq(reactions.videoId, id), eq(reactions.channelId, user.id)))
      : Promise.resolve([]),
    subscriberCount(row.channel.id),
    isSubscribed(user?.id, row.channel.id),
  ]);
  const { chunkSize, chunkCount, bonusLikes, ...video } = row.video;
  return json({
    video,
    channel: { id: row.channel.id, handle: row.channel.handle, name: row.channel.name, avatarVersion: row.channel.avatarVersion, frame: row.channel.frame },
    likes: tally.likes,
    dislikes: tally.dislikes,
    myReaction: mine[0]?.value ?? 0,
    subscribers: subs,
    subscribed,
    isOwner: user?.id === row.channel.id,
  });
});

/* ---------- Real view counting ----------
 * A view only counts when a real person actually watches:
 *  1. The player asks for a signed "watch ticket" when playback starts.
 *  2. After enough real playback (30s, or half of a short video), it redeems the ticket.
 *  3. The server checks that enough wall-clock time has passed since the ticket was issued,
 *     rejects obvious bots, and counts at most one view per viewer per video per day.
 */

let viewSecret: Promise<string> | null = null;
function getViewSecret() {
  viewSecret ??= (async (): Promise<string> => {
    const store = mediaStore();
    const existing = await store.get("config/view-secret", { type: "text" });
    if (existing) return existing;
    const fresh = randomBytes(32).toString("hex");
    await store.set("config/view-secret", fresh);
    return fresh;
  })();
  return viewSecret;
}

const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|curl|wget|python|httpclient|axios|node-fetch|go-http/i;

function viewThreshold(durationSeconds: number) {
  if (durationSeconds <= 0) return 10;
  return Math.max(3, Math.min(30, Math.floor(durationSeconds / 2)));
}

async function viewerKey(req: Request, context: Context) {
  const user = await currentUser();
  if (user) return `u:${user.id}`;
  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  return "a:" + createHash("sha256").update(`${await getViewSecret()}|${ip}|${ua}`).digest("base64url").slice(0, 32);
}

async function sign(payload: string) {
  return createHmac("sha256", await getViewSecret()).update(payload).digest("base64url");
}

route("POST", "/videos/:id/watch", async (req, { id }, _url, context) => {
  if (BOT_UA.test(req.headers.get("user-agent") || "")) return json({ ticket: null });
  const [v] = await db
    .select({ d: videos.durationSeconds })
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(and(eq(videos.id, id), publicOnly));
  if (!v) throw new HttpError(404, "Video not found.");
  const key = await viewerKey(req, context);
  const payload = `${id}.${key}.${Date.now()}`;
  return json({ ticket: `${payload}.${await sign(payload)}`, after: viewThreshold(v.d) });
});

route("POST", "/videos/:id/view", async (req, { id }, _url, context) => {
  const { ticket, watched } = await body<{ ticket?: string; watched?: number }>(req);
  if (typeof ticket !== "string" || BOT_UA.test(req.headers.get("user-agent") || "")) return json({ counted: false });
  const parts = ticket.split(".");
  const mac = parts.pop()!;
  const payload = parts.join(".");
  const expected = await sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return json({ counted: false });
  }
  const issued = Number(parts[parts.length - 1]);
  const key = parts.slice(1, -1).join(".");
  if (parts[0] !== id || key !== (await viewerKey(req, context))) return json({ counted: false });

  const [v] = await db.select({ d: videos.durationSeconds, owner: videos.channelId }).from(videos).where(and(eq(videos.id, id), readyOnly));
  if (!v) return json({ counted: false });
  const need = viewThreshold(v.d);
  const elapsed = (Date.now() - issued) / 1000;
  // Wall-clock time must cover the claimed playback; tickets expire after 6 hours.
  if (elapsed < need - 1 || elapsed > 6 * 3600 || !(Number(watched) >= need)) return json({ counted: false });
  // Creators watching their own video don't inflate their numbers.
  if (key === `u:${v.owner}`) return json({ counted: false });

  const day = new Date().toISOString().slice(0, 10);
  const inserted = await db.insert(videoViews).values({ videoId: id, viewerKey: key, day }).onConflictDoNothing().returning({ d: videoViews.day });
  if (!inserted.length) return json({ counted: false });
  const [u] = await db.update(videos).set({ views: sql`${videos.views} + 1` }).where(eq(videos.id, id)).returning({ views: videos.views });
  return json({ counted: true, views: u?.views });
});

route("POST", "/videos/:id/reaction", async (req, { id }) => {
  const me = await requireChannel();
  const { value } = await body<{ value?: number }>(req);
  const v = value === 1 ? 1 : value === -1 ? -1 : 0;
  const [video] = await db.select({ id: videos.id }).from(videos).where(and(eq(videos.id, id), readyOnly));
  if (!video) throw new HttpError(404, "Video not found.");
  if (v === 0) {
    await db.delete(reactions).where(and(eq(reactions.videoId, id), eq(reactions.channelId, me.id)));
  } else {
    await db
      .insert(reactions)
      .values({ videoId: id, channelId: me.id, value: v })
      .onConflictDoUpdate({ target: [reactions.videoId, reactions.channelId], set: { value: v } });
  }
  const tally = await likeTally(id);
  return json({ myReaction: v, ...tally });
});

/* ---------- Reports ---------- */

// Viewers flag inappropriate videos; reporting again replaces the earlier report and reopens it.
route("POST", "/videos/:id/report", async (req, { id }) => {
  const me = await requireChannel();
  const input = await body<{ reason?: string; details?: string }>(req);
  const reason = REPORT_REASONS.find((r) => r.id === input.reason)?.id;
  if (!reason) throw new HttpError(422, "Pick a reason for the report.");
  const details = clean(input.details, 500);
  if (reason === "other" && !details) throw new HttpError(422, "Tell us what's wrong with this video.");
  const [video] = await db.select({ id: videos.id, channelId: videos.channelId }).from(videos).where(and(eq(videos.id, id), readyOnly));
  if (!video) throw new HttpError(404, "Video not found.");
  if (video.channelId === me.id) throw new HttpError(422, "You can't report your own video.");
  await db
    .insert(videoReports)
    .values({ videoId: id, reporterId: me.id, reason, details })
    .onConflictDoUpdate({
      target: [videoReports.videoId, videoReports.reporterId],
      set: { reason, details, status: "open", createdAt: new Date() },
    });
  return json({ ok: true });
});

/* ---------- Comments ---------- */

route("GET", "/videos/:id/comments", async (_req, { id }) => {
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      channel: channelRef(),
    })
    .from(comments)
    .innerJoin(channels, eq(comments.channelId, channels.id))
    .where(and(eq(comments.videoId, id), eq(channels.banned, false)))
    .orderBy(desc(comments.createdAt))
    .limit(200);
  return json({ comments: rows });
});

route("POST", "/videos/:id/comments", async (req, { id }) => {
  const me = await requireChannel();
  const text = clean((await body(req)).body, 2000);
  if (!text) throw new HttpError(422, "Comment can't be empty.");
  const [video] = await db.select({ id: videos.id }).from(videos).where(and(eq(videos.id, id), readyOnly));
  if (!video) throw new HttpError(404, "Video not found.");
  const [c] = await db.insert(comments).values({ videoId: id, channelId: me.id, body: text }).returning();
  return json(
    { comment: { id: c.id, body: c.body, createdAt: c.createdAt, channel: { id: me.id, handle: me.handle, name: me.name, avatarVersion: me.avatarVersion, frame: me.frame } } },
    201,
  );
});

route("DELETE", "/comments/:id", async (_req, { id }) => {
  const me = await requireChannel();
  const [c] = await db
    .select({ id: comments.id, author: comments.channelId, owner: videos.channelId })
    .from(comments)
    .innerJoin(videos, eq(comments.videoId, videos.id))
    .where(eq(comments.id, Number(id)))
    .limit(1);
  if (!c) throw new HttpError(404, "Comment not found.");
  // Authors can delete their comments; creators can moderate comments on their own videos.
  if (c.author !== me.id && c.owner !== me.id && !isAdminChannel(me)) throw new HttpError(403, "You can't delete that comment.");
  await db.delete(comments).where(eq(comments.id, c.id));
  return json({ ok: true });
});

/* ---------- Community posts ---------- */

const MAX_POLL_OPTIONS = 5;
const postColumns = {
  id: posts.id,
  body: posts.body,
  hasImage: posts.hasImage,
  pollOptions: posts.pollOptions,
  createdAt: posts.createdAt,
  channel: channelRef(),
};
type PostRow = {
  id: string;
  body: string;
  hasImage: number;
  pollOptions: string[] | null;
  createdAt: Date;
  channel: { id: string; handle: string; name: string; avatarVersion: number; frame: string };
};

// Adds like/comment counts, poll results and the viewer's own like/vote to a list of posts.
async function decoratePosts(rows: PostRow[], viewerId: string | undefined) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [likes, commentCounts, votes, myLikes, myVotes] = await Promise.all([
    db.select({ id: postLikes.postId, n: count() }).from(postLikes).where(inArray(postLikes.postId, ids)).groupBy(postLikes.postId),
    db
      .select({ id: postComments.postId, n: count() })
      .from(postComments)
      .innerJoin(channels, eq(postComments.channelId, channels.id))
      .where(and(inArray(postComments.postId, ids), eq(channels.banned, false)))
      .groupBy(postComments.postId),
    db
      .select({ id: postVotes.postId, option: postVotes.option, n: count() })
      .from(postVotes)
      .where(inArray(postVotes.postId, ids))
      .groupBy(postVotes.postId, postVotes.option),
    viewerId
      ? db.select({ id: postLikes.postId }).from(postLikes).where(and(inArray(postLikes.postId, ids), eq(postLikes.channelId, viewerId)))
      : Promise.resolve([]),
    viewerId
      ? db
          .select({ id: postVotes.postId, option: postVotes.option })
          .from(postVotes)
          .where(and(inArray(postVotes.postId, ids), eq(postVotes.channelId, viewerId)))
      : Promise.resolve([]),
  ]);
  const likeMap = new Map(likes.map((l) => [l.id, l.n]));
  const commentMap = new Map(commentCounts.map((c) => [c.id, c.n]));
  const liked = new Set(myLikes.map((l) => l.id));
  const myVoteMap = new Map(myVotes.map((v) => [v.id, v.option]));
  return rows.map((r) => {
    const poll = r.pollOptions
      ? {
          options: r.pollOptions.map((label, i) => ({
            label,
            votes: votes.find((v) => v.id === r.id && v.option === i)?.n ?? 0,
          })),
          myVote: myVoteMap.has(r.id) ? myVoteMap.get(r.id)! : null,
        }
      : null;
    return {
      id: r.id,
      body: r.body,
      hasImage: r.hasImage,
      createdAt: r.createdAt,
      channel: r.channel,
      likes: likeMap.get(r.id) ?? 0,
      liked: liked.has(r.id),
      comments: commentMap.get(r.id) ?? 0,
      poll,
    };
  });
}

async function postsWhere(where: SQL | undefined, viewerId: string | undefined, limit = 50) {
  const rows = await db
    .select(postColumns)
    .from(posts)
    .innerJoin(channels, eq(posts.channelId, channels.id))
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  return decoratePosts(rows as PostRow[], viewerId);
}

async function visiblePost(id: string) {
  const [p] = await db
    .select({ id: posts.id, channelId: posts.channelId, pollOptions: posts.pollOptions, hasImage: posts.hasImage })
    .from(posts)
    .innerJoin(channels, eq(posts.channelId, channels.id))
    .where(and(eq(posts.id, id), eq(channels.banned, false)))
    .limit(1);
  if (!p) throw new HttpError(404, "Post not found.");
  return p;
}

route("GET", "/channels/:handle/posts", async (_req, { handle }) => {
  const [channel] = await db.select().from(channels).where(eq(channels.handle, handle.toLowerCase())).limit(1);
  if (!channel) throw new HttpError(404, "Channel not found.");
  const user = await currentUser();
  if (channel.banned && user?.id !== channel.id) {
    const viewer = user ? await getChannelById(user.id) : null;
    if (!isAdminChannel(viewer)) throw new HttpError(404, "This channel isn't available.");
  }
  return json({ posts: await postsWhere(eq(posts.channelId, channel.id), user?.id, 100) });
});

route("GET", "/feed/posts", async () => {
  const me = await requireChannel();
  const subs = db.select({ id: subscriptions.channelId }).from(subscriptions).where(eq(subscriptions.subscriberId, me.id));
  return json({ posts: await postsWhere(and(eq(channels.banned, false), inArray(posts.channelId, subs)), me.id, 30) });
});

route("GET", "/posts/:id", async (_req, { id }) => {
  await visiblePost(id);
  const user = await currentUser();
  const [post] = await postsWhere(eq(posts.id, id), user?.id, 1);
  return json({ post });
});

// Multipart form: body (text), poll (JSON array of answers, optional), image (JPEG file, optional).
route("POST", "/posts", async (req) => {
  const me = await requireChannel();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Invalid form data.");
  }
  const text = clean(form.get("body"), 5000);
  let pollOptions: string[] | null = null;
  const pollRaw = form.get("poll");
  if (typeof pollRaw === "string" && pollRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pollRaw);
    } catch {
      throw new HttpError(422, "Invalid poll.");
    }
    const opts = Array.isArray(parsed) ? parsed.map((o) => clean(o, 80)).filter(Boolean) : [];
    if (opts.length < 2) throw new HttpError(422, "A poll needs at least 2 answers.");
    if (opts.length > MAX_POLL_OPTIONS) throw new HttpError(422, `A poll can have up to ${MAX_POLL_OPTIONS} answers.`);
    pollOptions = opts;
  }
  const image = form.get("image");
  const imageFile = image && typeof image !== "string" && image.size > 0 ? image : null;
  if (imageFile && imageFile.size > MAX_IMAGE_BYTES) throw new HttpError(422, "Images must be under 4 MB.");
  if (imageFile && pollOptions) throw new HttpError(422, "A post can have an image or a poll, not both.");
  if (!text && !imageFile) throw new HttpError(422, "Write something or add an image.");
  if (!text && pollOptions) throw new HttpError(422, "Add a question for your poll.");

  const id = newId();
  if (imageFile) await mediaStore().set(postImageKey(id), await imageFile.arrayBuffer());
  await db.insert(posts).values({ id, channelId: me.id, body: text, hasImage: imageFile ? 1 : 0, pollOptions });
  const [post] = await postsWhere(eq(posts.id, id), me.id, 1);
  return json({ post }, 201);
});

route("DELETE", "/posts/:id", async (_req, { id }) => {
  const me = await requireChannel();
  const [p] = await db.select({ id: posts.id, channelId: posts.channelId }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!p) throw new HttpError(404, "Post not found.");
  if (p.channelId !== me.id && !isAdminChannel(me)) throw new HttpError(403, "You can't delete that post.");
  await db.delete(posts).where(eq(posts.id, id));
  await mediaStore().delete(postImageKey(id));
  return json({ ok: true });
});

route("POST", "/posts/:id/like", async (req, { id }) => {
  const me = await requireChannel();
  const { on } = await body<{ on?: boolean }>(req);
  await visiblePost(id);
  if (on) await db.insert(postLikes).values({ postId: id, channelId: me.id }).onConflictDoNothing();
  else await db.delete(postLikes).where(and(eq(postLikes.postId, id), eq(postLikes.channelId, me.id)));
  const [r] = await db.select({ n: count() }).from(postLikes).where(eq(postLikes.postId, id));
  return json({ liked: !!on, likes: r?.n ?? 0 });
});

route("POST", "/posts/:id/vote", async (req, { id }) => {
  const me = await requireChannel();
  const { option } = await body<{ option?: number | null }>(req);
  const p = await visiblePost(id);
  if (!p.pollOptions) throw new HttpError(422, "This post has no poll.");
  if (option === null || option === undefined) {
    await db.delete(postVotes).where(and(eq(postVotes.postId, id), eq(postVotes.channelId, me.id)));
  } else {
    if (!Number.isInteger(option) || option < 0 || option >= p.pollOptions.length) throw new HttpError(422, "Pick one of the answers.");
    await db
      .insert(postVotes)
      .values({ postId: id, channelId: me.id, option })
      .onConflictDoUpdate({ target: [postVotes.postId, postVotes.channelId], set: { option } });
  }
  const [post] = await postsWhere(eq(posts.id, id), me.id, 1);
  return json({ poll: post?.poll ?? null });
});

route("GET", "/posts/:id/comments", async (_req, { id }) => {
  await visiblePost(id);
  const rows = await db
    .select({ id: postComments.id, body: postComments.body, createdAt: postComments.createdAt, channel: channelRef() })
    .from(postComments)
    .innerJoin(channels, eq(postComments.channelId, channels.id))
    .where(and(eq(postComments.postId, id), eq(channels.banned, false)))
    .orderBy(desc(postComments.createdAt))
    .limit(200);
  return json({ comments: rows });
});

route("POST", "/posts/:id/comments", async (req, { id }) => {
  const me = await requireChannel();
  const text = clean((await body(req)).body, 2000);
  if (!text) throw new HttpError(422, "Comment can't be empty.");
  await visiblePost(id);
  const [c] = await db.insert(postComments).values({ postId: id, channelId: me.id, body: text }).returning();
  return json(
    { comment: { id: c.id, body: c.body, createdAt: c.createdAt, channel: { id: me.id, handle: me.handle, name: me.name, avatarVersion: me.avatarVersion, frame: me.frame } } },
    201,
  );
});

route("DELETE", "/post-comments/:id", async (_req, { id }) => {
  const me = await requireChannel();
  const [c] = await db
    .select({ id: postComments.id, author: postComments.channelId, owner: posts.channelId })
    .from(postComments)
    .innerJoin(posts, eq(postComments.postId, posts.id))
    .where(eq(postComments.id, Number(id)))
    .limit(1);
  if (!c) throw new HttpError(404, "Comment not found.");
  if (c.author !== me.id && c.owner !== me.id && !isAdminChannel(me)) throw new HttpError(403, "You can't delete that comment.");
  await db.delete(postComments).where(eq(postComments.id, c.id));
  return json({ ok: true });
});

/* ---------- Studio: uploads & management ---------- */

route("GET", "/studio/videos", async () => {
  const me = await requireChannel();
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      description: videos.description,
      status: videos.status,
      views: videos.views,
      durationSeconds: videos.durationSeconds,
      sizeBytes: videos.sizeBytes,
      hasThumbnail: videos.hasThumbnail,
      createdAt: videos.createdAt,
      publishedAt: videos.publishedAt,
      comments: sql<number>`(select count(*)::int from "comments" c where c."video_id" = "videos"."id")`,
      likes: sql<number>`((select count(*)::int from "reactions" r where r."video_id" = "videos"."id" and r."value" = 1) + "videos"."bonus_likes")::int`,
      promotedUntil: videos.promotedUntil,
      isShort: videos.isShort,
    })
    .from(videos)
    .where(eq(videos.channelId, me.id))
    .orderBy(desc(videos.createdAt));
  return json({ videos: rows });
});

route("POST", "/studio/videos", async (req) => {
  const me = await requireChannel();
  const input = await body(req);
  const title = clean(input.title, 120);
  const description = clean(input.description, 5000);
  const mimeType = clean(input.mimeType, 50);
  const sizeBytes = Number(input.sizeBytes);
  const durationSeconds = Math.max(0, Math.round(Number(input.durationSeconds) || 0));
  const isShort = input.isShort === true;
  if (!title) throw new HttpError(422, "Add a title.");
  if (!ALLOWED_MIME.includes(mimeType)) throw new HttpError(422, "Upload an MP4, WebM, MOV or OGG video.");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new HttpError(422, "Invalid file size.");
  if (sizeBytes > MAX_VIDEO_BYTES) throw new HttpError(413, "Videos can be up to 500 MB.");

  const chunkCount = Math.ceil(sizeBytes / CHUNK_SIZE);
  const [video] = await db
    .insert(videos)
    .values({
      id: newId(),
      channelId: me.id,
      title,
      description,
      mimeType,
      sizeBytes,
      durationSeconds,
      isShort,
      chunkSize: CHUNK_SIZE,
      chunkCount,
    })
    .returning();
  return json({ id: video.id, chunkSize: CHUNK_SIZE, chunkCount }, 201);
});

route("PUT", "/studio/videos/:id/chunks/:n", async (req, { id, n }) => {
  const { video } = await ownVideo(id);
  if (video.status !== "uploading") throw new HttpError(409, "This video is already published.");
  const index = Number(n);
  if (!Number.isInteger(index) || index < 0 || index >= video.chunkCount) throw new HttpError(422, "Bad chunk index.");
  const data = await req.arrayBuffer();
  const expected =
    index === video.chunkCount - 1 ? video.sizeBytes - index * video.chunkSize : video.chunkSize;
  if (data.byteLength !== expected) throw new HttpError(422, `Chunk ${index} should be ${expected} bytes.`);
  await mediaStore().set(chunkKey(id, index), data);
  return json({ ok: true });
});

route("PUT", "/studio/videos/:id/thumbnail", async (req, { id }) => {
  await ownVideo(id);
  const data = await req.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > MAX_THUMB_BYTES) throw new HttpError(422, "Thumbnail must be under 2 MB.");
  await mediaStore().set(thumbKey(id), data);
  await db.update(videos).set({ hasThumbnail: 1 }).where(eq(videos.id, id));
  return json({ ok: true });
});

route("POST", "/studio/videos/:id/publish", async (_req, { id }) => {
  const { video } = await ownVideo(id);
  if (video.status === "ready") return json({ ok: true });
  const { blobs } = await mediaStore().list({ prefix: chunkPrefix(id) });
  if (blobs.length < video.chunkCount) {
    throw new HttpError(409, `Upload incomplete (${blobs.length}/${video.chunkCount} parts received).`);
  }
  await db.update(videos).set({ status: "ready", publishedAt: new Date() }).where(eq(videos.id, id));
  return json({ ok: true });
});

route("PATCH", "/studio/videos/:id", async (req, { id }) => {
  await ownVideo(id);
  const input = await body(req);
  const title = clean(input.title, 120);
  const description = clean(input.description, 5000);
  if (!title) throw new HttpError(422, "Add a title.");
  const patch: { title: string; description: string; isShort?: boolean } = { title, description };
  if (typeof input.isShort === "boolean") patch.isShort = input.isShort;
  await db.update(videos).set(patch).where(eq(videos.id, id));
  return json({ ok: true });
});

route("DELETE", "/studio/videos/:id", async (_req, { id }) => {
  await ownVideo(id);
  await db.delete(videos).where(eq(videos.id, id));
  await deleteVideoBlobs(id);
  return json({ ok: true });
});

/* ---------- Promotion (spend coins to get featured in front of real viewers) ---------- */

const PROMO_PACKS = [
  { id: "day", hours: 24, coins: 200, label: "1 day" },
  { id: "3days", hours: 72, coins: 500, label: "3 days" },
  { id: "week", hours: 168, coins: 1_000, label: "7 days" },
  { id: "month", hours: 720, coins: 3_500, label: "30 days" },
];

route("GET", "/store", async () => {
  const me = await requireChannel();
  return json({ packs: PROMO_PACKS, coins: me.coins });
});

route("POST", "/studio/videos/:id/promote", async (req, { id }) => {
  const { channel, video } = await ownVideo(id);
  if (video.status !== "ready") throw new HttpError(409, "Publish the video before promoting it.");
  const { pack: packId } = await body<{ pack?: string }>(req);
  const pack = PROMO_PACKS.find((p) => p.id === packId);
  if (!pack) throw new HttpError(422, "Pick a promotion length.");
  return json(
    await db.transaction(async (tx) => {
      // Conditional update so two clicks at once can't overspend.
      const [paid] = await tx
        .update(channels)
        .set({ coins: sql`${channels.coins} - ${pack.coins}` })
        .where(and(eq(channels.id, channel.id), sql`${channels.coins} >= ${pack.coins}`))
        .returning({ coins: channels.coins });
      if (!paid) throw new HttpError(402, `Not enough coins — you need ${pack.coins.toLocaleString("en-US")}.`);
      // Stack on top of any promotion that is still running.
      const [v] = await tx
        .update(videos)
        .set({ promotedUntil: sql`greatest(coalesce(${videos.promotedUntil}, now()), now()) + make_interval(hours => ${pack.hours})` })
        .where(eq(videos.id, id))
        .returning({ promotedUntil: videos.promotedUntil });
      return { coins: paid.coins, promotedUntil: v.promotedUntil };
    }),
  );
});

// Promoted videos shown at the top of the home page.
route("GET", "/promoted", async () => {
  const rows = await db
    .select(cardColumns)
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(and(publicOnly, sql`${videos.promotedUntil} > now()`))
    .orderBy(sql`random()`)
    .limit(8);
  return json({ videos: rows });
});

/* ---------- Coins for real money (Stripe Checkout) ---------- */

const CURRENCY = (process.env.STRIPE_CURRENCY || "pln").toLowerCase();
const COIN_PACKS = [
  { id: "c500", coins: 500, amount: 999 },
  { id: "c1200", coins: 1_200, amount: 1999 },
  { id: "c3500", coins: 3_500, amount: 4999 },
  { id: "c8000", coins: 8_000, amount: 9999 },
];

async function stripe<T = any>(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, "Payments aren't set up yet. The site owner needs to add a Stripe key.");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Stripe error", res.status, data?.error?.message);
    throw new HttpError(502, data?.error?.message || "Payment provider error.");
  }
  return data as T;
}

type StripeSession = {
  id: string;
  payment_status: string;
  amount_total: number;
  currency: string;
  metadata: { channelId?: string; packId?: string };
};

// Credits a paid Checkout session exactly once, however many times it is reported.
async function creditSession(session: StripeSession) {
  if (session.payment_status !== "paid") return null;
  const pack = COIN_PACKS.find((p) => p.id === session.metadata?.packId);
  const channelId = session.metadata?.channelId;
  if (!pack || !channelId) return null;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(coinPurchases)
      .values({ sessionId: session.id, channelId, packId: pack.id, coins: pack.coins, amountCents: session.amount_total, currency: session.currency })
      .onConflictDoNothing()
      .returning({ id: coinPurchases.sessionId });
    if (!inserted.length) return { credited: false, coins: pack.coins };
    await tx.update(channels).set({ coins: sql`${channels.coins} + ${pack.coins}` }).where(eq(channels.id, channelId));
    return { credited: true, coins: pack.coins };
  });
}

route("GET", "/coins/packs", async () => {
  return json({ packs: COIN_PACKS, currency: CURRENCY, enabled: !!process.env.STRIPE_SECRET_KEY });
});

route("POST", "/coins/checkout", async (req, _p, url) => {
  const me = await requireChannel();
  const user = await requireUser();
  const { pack: packId } = await body<{ pack?: string }>(req);
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) throw new HttpError(422, "Pick a coin pack.");
  const origin = url.origin;
  const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
    mode: "payment",
    success_url: `${origin}/coins?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/coins?canceled=1`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": CURRENCY,
    "line_items[0][price_data][unit_amount]": String(pack.amount),
    "line_items[0][price_data][product_data][name]": `${pack.coins.toLocaleString("en-US")} Reelroom coins`,
    client_reference_id: me.id,
    "metadata[channelId]": me.id,
    "metadata[packId]": pack.id,
    ...(user.email ? { customer_email: user.email } : {}),
  });
  return json({ url: session.url });
});

// Called when the buyer returns from Checkout.
route("POST", "/coins/confirm", async (req) => {
  const me = await requireChannel();
  const { sessionId } = await body<{ sessionId?: string }>(req);
  if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new HttpError(422, "Invalid session.");
  const session = await stripe<StripeSession>("GET", `/checkout/sessions/${sessionId}`);
  if (session.metadata?.channelId !== me.id) throw new HttpError(403, "That payment belongs to another channel.");
  if (session.payment_status !== "paid") return json({ status: "pending" });
  const r = await creditSession(session);
  const fresh = await getChannelById(me.id);
  return json({ status: "paid", added: r?.coins ?? 0, coins: fresh?.coins ?? me.coins });
});

// Stripe webhook backup, in case the buyer closes the tab before returning. Optional: needs STRIPE_WEBHOOK_SECRET.
route("POST", "/stripe/webhook", async (req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(404, "Not found.");
  const raw = await req.text();
  const header = req.headers.get("stripe-signature") || "";
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  const expected = createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
  const valid = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .some((kv) => {
      const sig = kv.slice(3);
      return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    });
  if (!valid || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) throw new HttpError(400, "Bad signature.");
  const event = JSON.parse(raw);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await creditSession(event.data.object as StripeSession);
  }
  return json({ received: true });
});

/* ---------- Admin ---------- */

const likeTerm = (q: string) => `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;

route("GET", "/admin/overview", async () => {
  await requireAdmin();
  const [[c], [v], [cm], [b], [rev], [rep]] = await Promise.all([
    db.select({ n: count() }).from(channels),
    db
      .select({ n: count(), views: sql<number>`coalesce(sum(${videos.views}), 0)::bigint` })
      .from(videos),
    db.select({ n: count() }).from(comments),
    db.select({ n: count() }).from(channels).where(eq(channels.banned, true)),
    db.select({ cents: sql<number>`coalesce(sum(${coinPurchases.amountCents}), 0)::bigint` }).from(coinPurchases),
    db.select({ n: sql<number>`count(distinct ${videoReports.videoId})::int` }).from(videoReports).where(eq(videoReports.status, "open")),
  ]);
  return json({ channels: c.n, videos: v.n, views: Number(v.views), comments: cm.n, banned: b.n, reported: rep.n, revenueCents: Number(rev.cents), currency: CURRENCY });
});

route("GET", "/admin/videos", async (_req, _p, url) => {
  await requireAdmin();
  const q = clean(url.searchParams.get("q"), 100);
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      status: videos.status,
      views: videos.views,
      bonusLikes: videos.bonusLikes,
      promotedUntil: videos.promotedUntil,
      isShort: videos.isShort,
      durationSeconds: videos.durationSeconds,
      hasThumbnail: videos.hasThumbnail,
      createdAt: videos.createdAt,
      likes: sql<number>`(select count(*)::int from "reactions" r where r."video_id" = "videos"."id" and r."value" = 1)`,
      comments: sql<number>`(select count(*)::int from "comments" c where c."video_id" = "videos"."id")`,
      channel: { ...channelRef(), banned: channels.banned },
    })
    .from(videos)
    .innerJoin(channels, eq(videos.channelId, channels.id))
    .where(q ? or(ilike(videos.title, likeTerm(q)), ilike(channels.name, likeTerm(q)), ilike(channels.handle, likeTerm(q))) : undefined)
    .orderBy(desc(videos.createdAt))
    .limit(200);
  return json({ videos: rows });
});

const intIn = (v: unknown, label: string, max = 2_000_000_000) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(422, `${label} must be 0 – ${max.toLocaleString("en-US")}.`);
  return n;
};

route("PATCH", "/admin/videos/:id", async (req, { id }) => {
  await requireAdmin();
  const input = await body<{ views?: number; bonusLikes?: number; promoteHours?: number }>(req);
  const set: Record<string, unknown> = {};
  if (input.views !== undefined) set.views = intIn(input.views, "Views");
  if (input.bonusLikes !== undefined) set.bonusLikes = intIn(input.bonusLikes, "Extra likes");
  if (input.promoteHours !== undefined) {
    const h = intIn(input.promoteHours, "Promotion hours", 24 * 365);
    set.promotedUntil = h === 0 ? null : sql`greatest(coalesce(${videos.promotedUntil}, now()), now()) + make_interval(hours => ${h})`;
  }
  if (!Object.keys(set).length) throw new HttpError(422, "Nothing to change.");
  const [v] = await db
    .update(videos)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(set as any)
    .where(eq(videos.id, id))
    .returning({ views: videos.views, bonusLikes: videos.bonusLikes, promotedUntil: videos.promotedUntil });
  if (!v) throw new HttpError(404, "Video not found.");
  return json(v);
});

route("DELETE", "/admin/videos/:id", async (_req, { id }) => {
  await requireAdmin();
  const [v] = await db.delete(videos).where(eq(videos.id, id)).returning({ id: videos.id });
  if (!v) throw new HttpError(404, "Video not found.");
  await deleteVideoBlobs(id);
  return json({ ok: true });
});

route("GET", "/admin/channels", async (_req, _p, url) => {
  await requireAdmin();
  const q = clean(url.searchParams.get("q"), 100);
  const filter = url.searchParams.get("filter");
  const conds = [];
  if (q) conds.push(or(ilike(channels.name, likeTerm(q)), ilike(channels.handle, likeTerm(q)))!);
  if (filter === "banned") conds.push(eq(channels.banned, true));
  const rows = await db
    .select({
      id: channels.id,
      handle: channels.handle,
      name: channels.name,
      avatarVersion: channels.avatarVersion,
      frame: channels.frame,
      isAdmin: channels.isAdmin,
      banned: channels.banned,
      banReason: channels.banReason,
      coins: channels.coins,
      createdAt: channels.createdAt,
      videos: sql<number>`(select count(*)::int from "videos" v where v."channel_id" = "channels"."id")`,
      realSubscribers: sql<number>`(select count(*)::int from "subscriptions" s where s."channel_id" = "channels"."id")`,
      bonusSubscribers: channels.bonusSubscribers,
    })
    .from(channels)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(channels.createdAt))
    .limit(200);
  return json({
    channels: rows.map((r) => ({
      ...r,
      subscribers: r.realSubscribers + r.bonusSubscribers,
      isAdmin: isAdminChannel(r),
      isOwner: r.handle === OWNER_HANDLE,
    })),
  });
});

route("PATCH", "/admin/channels/:id", async (req, { id }) => {
  const me = await requireAdmin();
  const input = await body<{
    coins?: number;
    isAdmin?: boolean;
    banned?: boolean;
    banReason?: string;
    bonusSubscribers?: number;
    addSubscribers?: number;
  }>(req);
  const target = await getChannelById(id);
  if (!target) throw new HttpError(404, "Channel not found.");
  const set: Partial<ChannelRow> = {};
  if (input.coins !== undefined) set.coins = intIn(input.coins, "Coins");
  if (input.bonusSubscribers !== undefined) set.bonusSubscribers = intIn(input.bonusSubscribers, "Extra subscribers");
  if (input.addSubscribers !== undefined) {
    set.bonusSubscribers = Math.min(2_000_000_000, target.bonusSubscribers + intIn(input.addSubscribers, "Subscribers to add"));
  }
  if (input.isAdmin !== undefined) {
    if (!input.isAdmin && (target.handle === OWNER_HANDLE || target.id === me.id)) {
      throw new HttpError(422, "You can't remove admin from the owner or yourself.");
    }
    // Only the owner can hand out admin rights.
    if (input.isAdmin && me.handle !== OWNER_HANDLE) throw new HttpError(403, "Only the owner can make new admins.");
    set.isAdmin = !!input.isAdmin;
  }
  if (input.banned !== undefined) {
    if (input.banned) {
      if (target.handle === OWNER_HANDLE || target.id === me.id) throw new HttpError(422, "You can't ban the owner or yourself.");
      if (isAdminChannel(target) && me.handle !== OWNER_HANDLE) throw new HttpError(403, "Only the owner can ban another admin.");
      set.banned = true;
      set.banReason = clean(input.banReason, 300);
      set.isAdmin = false;
    } else {
      set.banned = false;
      set.banReason = "";
    }
  }
  if (!Object.keys(set).length) throw new HttpError(422, "Nothing to change.");
  const [c] = await db.update(channels).set(set).where(eq(channels.id, id)).returning();
  const [real] = await db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.channelId, c.id));
  return json({
    channel: {
      ...publicChannel(c),
      coins: c.coins,
      isAdmin: isAdminChannel(c),
      banned: c.banned,
      banReason: c.banReason,
      bonusSubscribers: c.bonusSubscribers,
      realSubscribers: real?.n ?? 0,
      subscribers: (real?.n ?? 0) + c.bonusSubscribers,
    },
  });
});

route("DELETE", "/admin/channels/:id", async (_req, { id }) => {
  const me = await requireAdmin();
  const target = await getChannelById(id);
  if (!target) throw new HttpError(404, "Channel not found.");
  if (target.id === me.id || target.handle === OWNER_HANDLE) throw new HttpError(422, "You can't delete that channel.");
  const owned = await db.select({ id: videos.id }).from(videos).where(eq(videos.channelId, id));
  const ownedPosts = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.channelId, id), eq(posts.hasImage, 1)));
  await db.delete(channels).where(eq(channels.id, id));
  await deleteChannelBlobs(id, owned.map((v) => v.id));
  await Promise.all(ownedPosts.map((p) => mediaStore().delete(postImageKey(p.id))));
  return json({ ok: true });
});

/* ---------- Admin: coin gifts & seasonal theme ---------- */

const MAX_GIFT = 1_000_000;

route("GET", "/admin/gifts", async () => {
  await requireAdmin();
  const rows = await db
    .select({
      id: coinGifts.id,
      amount: coinGifts.amount,
      message: coinGifts.message,
      recipients: coinGifts.recipients,
      createdAt: coinGifts.createdAt,
      by: { handle: channels.handle, name: channels.name },
    })
    .from(coinGifts)
    .leftJoin(channels, eq(coinGifts.createdBy, channels.id))
    .orderBy(desc(coinGifts.id))
    .limit(50);
  return json({ gifts: rows });
});

// Gives every channel that isn't banned the same number of coins, e.g. a Christmas present.
route("POST", "/admin/gifts", async (req) => {
  const me = await requireAdmin();
  const input = await body<{ amount?: number; message?: string }>(req);
  const amount = Math.floor(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_GIFT) {
    throw new HttpError(422, `Gift between 1 and ${MAX_GIFT.toLocaleString("en-US")} coins.`);
  }
  const message = clean(input.message, 200);
  const updated = await db
    .update(channels)
    .set({ coins: sql`least(${channels.coins}::bigint + ${amount}, 2000000000)::int` })
    .where(eq(channels.banned, false))
    .returning({ id: channels.id });
  const [gift] = await db
    .insert(coinGifts)
    .values({ amount, message, recipients: updated.length, createdBy: me.id })
    .returning();
  // The admin who sent it shouldn't get a "you got a present" pop-up for their own gift.
  await db.update(channels).set({ seenGiftId: sql`greatest(${channels.seenGiftId}, ${gift.id})` }).where(eq(channels.id, me.id));
  return json({ gift });
});

route("PUT", "/admin/season", async (req) => {
  await requireAdmin();
  const { season } = await body<{ season?: string }>(req);
  const value = String(season ?? "");
  if (value && !THEMES.some((t) => t.id === value)) throw new HttpError(422, "Unknown theme.");
  await db
    .insert(siteSettings)
    .values({ key: "season", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: new Date() } });
  return json({ season: value });
});

// Reported videos, grouped so each video appears once with every report against it.
route("GET", "/admin/reports", async (_req, _p, url) => {
  await requireAdmin();
  const status = url.searchParams.get("filter") === "dismissed" ? "dismissed" : "open";
  const uploader = channels;
  const rows = await db
    .select({
      id: videoReports.id,
      reason: videoReports.reason,
      details: videoReports.details,
      createdAt: videoReports.createdAt,
      reporter: sql<{ id: string; handle: string; name: string }>`(select json_build_object('id', r."id", 'handle', r."handle", 'name', r."name") from "channels" r where r."id" = ${videoReports.reporterId})`,
      video: {
        id: videos.id,
        title: videos.title,
        views: videos.views,
        status: videos.status,
        isShort: videos.isShort,
        durationSeconds: videos.durationSeconds,
        hasThumbnail: videos.hasThumbnail,
        createdAt: videos.createdAt,
      },
      channel: { id: uploader.id, handle: uploader.handle, name: uploader.name, avatarVersion: uploader.avatarVersion, frame: uploader.frame, banned: uploader.banned },
    })
    .from(videoReports)
    .innerJoin(videos, eq(videoReports.videoId, videos.id))
    .innerJoin(uploader, eq(videos.channelId, uploader.id))
    .where(eq(videoReports.status, status))
    .orderBy(desc(videoReports.createdAt))
    .limit(1000);
  type Group = { video: (typeof rows)[number]["video"]; channel: (typeof rows)[number]["channel"]; lastReportedAt: Date; reports: { id: number; reason: string; details: string; createdAt: Date; reporter: { id: string; handle: string; name: string } }[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    let g = groups.get(r.video.id);
    if (!g) groups.set(r.video.id, (g = { video: r.video, channel: r.channel, lastReportedAt: r.createdAt, reports: [] }));
    g.reports.push({ id: r.id, reason: r.reason, details: r.details, createdAt: r.createdAt, reporter: r.reporter });
  }
  // Most-reported first, then most recent.
  const list = [...groups.values()].sort((a, b) => b.reports.length - a.reports.length || +new Date(b.lastReportedAt) - +new Date(a.lastReportedAt));
  return json({ reports: list });
});

// Keep the video: mark all of its open reports as dismissed (or reopen dismissed ones).
route("PATCH", "/admin/reports/:videoId", async (req, { videoId }) => {
  await requireAdmin();
  const { status } = await body<{ status?: string }>(req);
  if (status !== "dismissed" && status !== "open") throw new HttpError(422, "Unknown status.");
  const from = status === "dismissed" ? "open" : "dismissed";
  const updated = await db
    .update(videoReports)
    .set({ status })
    .where(and(eq(videoReports.videoId, videoId), eq(videoReports.status, from)))
    .returning({ id: videoReports.id });
  return json({ updated: updated.length });
});

route("GET", "/admin/comments", async (_req, _p, url) => {
  await requireAdmin();
  const q = clean(url.searchParams.get("q"), 100);
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      video: { id: videos.id, title: videos.title },
      channel: { ...channelRef(), banned: channels.banned },
    })
    .from(comments)
    .innerJoin(channels, eq(comments.channelId, channels.id))
    .innerJoin(videos, eq(comments.videoId, videos.id))
    .where(q ? or(ilike(comments.body, likeTerm(q)), ilike(channels.handle, likeTerm(q)), ilike(videos.title, likeTerm(q))) : undefined)
    .orderBy(desc(comments.createdAt))
    .limit(200);
  return json({ comments: rows });
});

// Sends a real Identity email so the branded templates can be checked in an inbox.
route("POST", "/admin/test-email", async (req) => {
  await requireAdmin();
  const input = await body<{ email?: string; kind?: string }>(req);
  const email = clean(input.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "Enter a valid email address.");
  const cfg = getIdentityConfig();
  if (!cfg?.url) throw new HttpError(503, "Identity isn't available here.");
  const kind = input.kind === "recovery" ? "recovery" : "confirmation";
  const res =
    kind === "recovery"
      ? await fetch(`${cfg.url}/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })
      : await fetch(`${cfg.url}/signup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // A random password: the tester can set a real one with "Forgot password" after confirming.
          body: JSON.stringify({ email, password: randomBytes(18).toString("base64url") }),
        });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.msg || data.error_description || data.error || `Identity returned ${res.status}`;
    if (kind === "confirmation" && /already registered/i.test(String(msg))) {
      throw new HttpError(409, "That address already has a confirmed account. Send a password reset email to test instead.");
    }
    throw new HttpError(502, String(msg));
  }
  return json({ ok: true, kind, email });
});

/* ---------- Owner wallet: Stripe balance and payouts to the owner's bank ---------- */

async function requireOwner() {
  const me = await requireAdmin();
  if (me.handle !== OWNER_HANDLE) throw new HttpError(403, "Only the site owner can manage the wallet.");
  return me;
}

route("GET", "/admin/wallet", async () => {
  await requireOwner();
  const purchases = await db
    .select({
      sessionId: coinPurchases.sessionId,
      coins: coinPurchases.coins,
      amountCents: coinPurchases.amountCents,
      currency: coinPurchases.currency,
      createdAt: coinPurchases.createdAt,
      channel: channelRef(),
    })
    .from(coinPurchases)
    .innerJoin(channels, eq(coinPurchases.channelId, channels.id))
    .orderBy(desc(coinPurchases.createdAt))
    .limit(50);
  if (!process.env.STRIPE_SECRET_KEY) return json({ enabled: false, purchases });
  type Amount = { amount: number; currency: string };
  const [balance, payouts] = await Promise.all([
    stripe<{ available: Amount[]; pending: Amount[] }>("GET", "/balance"),
    stripe<{ data: { id: string; amount: number; currency: string; status: string; arrival_date: number }[] }>("GET", "/payouts?limit=10"),
  ]);
  return json({
    enabled: true,
    available: balance.available,
    pending: balance.pending,
    payouts: payouts.data.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, arrivalDate: p.arrival_date })),
    purchases,
  });
});

route("POST", "/admin/wallet/payout", async (req) => {
  await requireOwner();
  const input = await body<{ amount?: number; currency?: string }>(req);
  const amount = Math.round(Number(input.amount));
  const currency = clean(input.currency, 3).toLowerCase() || CURRENCY;
  if (!Number.isFinite(amount) || amount < 100) throw new HttpError(422, "Payouts must be at least 1.00.");
  const balance = await stripe<{ available: { amount: number; currency: string }[] }>("GET", "/balance");
  const available = balance.available.find((b) => b.currency === currency)?.amount ?? 0;
  if (amount > available) throw new HttpError(422, "That's more than your available balance.");
  const p = await stripe<{ id: string; status: string; arrival_date: number }>("POST", "/payouts", {
    amount: String(amount),
    currency,
    description: "Reelroom payout",
  });
  return json({ id: p.id, status: p.status, arrivalDate: p.arrival_date });
});

/* ---------- Dispatcher ---------- */

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";

  // Simple CSRF guard: browsers can't send this custom header cross-origin without a CORS preflight we never allow.
  if (req.method !== "GET" && path !== "/stripe/webhook" && req.headers.get("x-reelroom") !== "1") {
    return json({ error: "Missing request header." }, 403);
  }

  let methodMismatch = false;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (!m) continue;
    if (r.method !== req.method) {
      methodMismatch = true;
      continue;
    }
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      return await r.handler(req, params, url, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong." }, 500);
    }
  }
  return json({ error: methodMismatch ? "Method not allowed." : "Not found." }, methodMismatch ? 405 : 404);
};

export const config: Config = {
  path: "/api/*",
};
