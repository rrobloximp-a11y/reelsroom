ALTER TABLE "channels" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "coins" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "avatar_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "banner_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "channels" SET "is_admin" = true WHERE "handle" = 'salweqx_';
