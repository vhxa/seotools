ALTER TABLE "crawls" ADD COLUMN "capacity_metrics" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "site_slowdown" boolean;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "capacity_generation" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "capacity_generation" text;