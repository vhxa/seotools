ALTER TABLE "crawl_settings" ADD COLUMN "include_prefixes" text;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "exclude_prefixes" text;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "max_depth" integer;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "request_secrets" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "seed_urls" text;