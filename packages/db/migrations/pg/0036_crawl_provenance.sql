ALTER TABLE "crawls" ADD COLUMN "started_build" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "run_builds" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "analysis_build" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "discovery_settings" text;--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ADD COLUMN "build" text;--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ADD COLUMN "outdated" boolean;