CREATE TABLE "post_comments" (
	"id" serial PRIMARY KEY,
	"post_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" text,
	"channel_id" text,
	CONSTRAINT "post_likes_pkey" PRIMARY KEY("post_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "post_votes" (
	"post_id" text,
	"channel_id" text,
	"option" smallint NOT NULL,
	CONSTRAINT "post_votes_pkey" PRIMARY KEY("post_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"has_image" smallint DEFAULT 0 NOT NULL,
	"poll_options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" ("post_id");--> statement-breakpoint
CREATE INDEX "posts_channel_idx" ON "posts" ("channel_id");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" ("created_at");--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;