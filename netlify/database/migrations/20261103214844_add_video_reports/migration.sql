CREATE TABLE "video_reports" (
	"id" serial PRIMARY KEY,
	"video_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "video_reports_video_reporter_idx" ON "video_reports" ("video_id","reporter_id");--> statement-breakpoint
CREATE INDEX "video_reports_status_idx" ON "video_reports" ("status");--> statement-breakpoint
ALTER TABLE "video_reports" ADD CONSTRAINT "video_reports_video_id_videos_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_reports" ADD CONSTRAINT "video_reports_reporter_id_channels_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "channels"("id") ON DELETE CASCADE;