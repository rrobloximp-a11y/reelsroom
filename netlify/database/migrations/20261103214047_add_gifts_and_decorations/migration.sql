CREATE TABLE "coin_gifts" (
	"id" serial PRIMARY KEY,
	"amount" integer NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "frame" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "theme" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "owned_cosmetics" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "seen_gift_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_created_by_channels_id_fkey" FOREIGN KEY ("created_by") REFERENCES "channels"("id") ON DELETE SET NULL;