CREATE TABLE "coin_purchases" (
	"session_id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"coins" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_views" (
	"video_id" text,
	"viewer_key" text,
	"day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_views_pkey" PRIMARY KEY("video_id","viewer_key","day")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "ban_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "bonus_likes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "promoted_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "coin_purchases_channel_idx" ON "coin_purchases" ("channel_id");--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_video_id_videos_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE;