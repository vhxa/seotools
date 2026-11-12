ALTER TABLE "crawl_settings" ADD COLUMN "ignored_parameters" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "ignored_parameters" text;