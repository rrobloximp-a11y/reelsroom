import { pgTable, text, timestamp, integer, bigint, serial, smallint, primaryKey, index, uniqueIndex, boolean, date, jsonb } from "drizzle-orm/pg-core";

// One channel per Identity user. `id` is the Identity user id.
export const channels = pgTable("channels", {
  id: text().primaryKey(),
  handle: text().notNull().unique(),
  name: text().notNull(),
  bio: text().notNull().default(""),
  isAdmin: boolean("is_admin").notNull().default(false),
  coins: integer().notNull().default(1000),
  // 0 = no custom image; bumped on every upload so URLs bust caches.
  avatarVersion: integer("avatar_version").notNull().default(0),
  bannerVersion: integer("banner_version").notNull().default(0),
  banned: boolean().notNull().default(false),
  banReason: text("ban_reason").notNull().default(""),
  // Subscribers added by an admin on top of real subscriptions.
  bonusSubscribers: integer("bonus_subscribers").notNull().default(0),
  // Profile decorations: equipped avatar frame and channel background ("" = none), plus everything bought.
  frame: text().notNull().default(""),
  theme: text().notNull().default(""),
  ownedCosmetics: jsonb("owned_cosmetics").$type<string[]>().notNull().default([]),
  // Highest coin gift this channel has already been told about.
  seenGiftId: integer("seen_gift_id").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videos = pgTable(
  "videos",
  {
    id: text().primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    chunkSize: integer("chunk_size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    hasThumbnail: smallint("has_thumbnail").notNull().default(0),
    status: text().notNull().default("uploading"), // uploading | ready
    views: integer().notNull().default(0),
    // Likes added by an admin on top of real reactions.
    bonusLikes: integer("bonus_likes").notNull().default(0),
    // Shorts are short vertical clips shown in the Shorts feed instead of the regular grid.
    isShort: boolean("is_short").notNull().default(false),
    promotedUntil: timestamp("promoted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("videos_channel_idx").on(t.channelId), index("videos_published_idx").on(t.publishedAt)],
);

export const comments = pgTable(
  "comments",
  {
    id: serial().primaryKey(),
    videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_video_idx").on(t.videoId)],
);

// value: 1 = like, -1 = dislike
export const reactions = pgTable(
  "reactions",
  {
    videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    value: smallint().notNull(),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.channelId] })],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    subscriberId: text("subscriber_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subscriberId, t.channelId] }), index("subs_channel_idx").on(t.channelId)],
);

// One counted view per viewer per video per day. viewer_key is a channel id or a hashed anonymous fingerprint.
export const videoViews = pgTable(
  "video_views",
  {
    videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    day: date().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.viewerKey, t.day] })],
);

// Stripe Checkout sessions that have already been credited. The primary key makes crediting idempotent.
export const coinPurchases = pgTable(
  "coin_purchases",
  {
    sessionId: text("session_id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    coins: integer().notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coin_purchases_channel_idx").on(t.channelId)],
);

// Community posts: short text updates on a channel, optionally with an image or a poll.
export const posts = pgTable(
  "posts",
  {
    id: text().primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    body: text().notNull().default(""),
    // 0 = no image; otherwise the image lives in Blobs at posts/<id>/image.
    hasImage: smallint("has_image").notNull().default(0),
    // Poll answers, or null when the post has no poll.
    pollOptions: jsonb("poll_options").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_channel_idx").on(t.channelId), index("posts_created_idx").on(t.createdAt)],
);

export const postLikes = pgTable(
  "post_likes",
  {
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.channelId] })],
);

// One vote per channel per poll; `option` is the index into posts.poll_options.
export const postVotes = pgTable(
  "post_votes",
  {
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    option: smallint().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.channelId] })],
);

export const postComments = pgTable(
  "post_comments",
  {
    id: serial().primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("post_comments_post_idx").on(t.postId)],
);

// Coins handed out by an admin to every channel at once (e.g. a Christmas present).
export const coinGifts = pgTable("coin_gifts", {
  id: serial().primaryKey(),
  amount: integer().notNull(),
  message: text().notNull().default(""),
  recipients: integer().notNull().default(0),
  createdBy: text("created_by").references(() => channels.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Site-wide settings set by admins, e.g. the seasonal theme everyone sees by default.
export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Viewer reports of inappropriate videos. One report per channel per video; admins review them in the Admin panel.
export const videoReports = pgTable(
  "video_reports",
  {
    id: serial().primaryKey(),
    videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    details: text().notNull().default(""),
    status: text().notNull().default("open"), // open | dismissed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("video_reports_video_reporter_idx").on(t.videoId, t.reporterId), index("video_reports_status_idx").on(t.status)],
);
