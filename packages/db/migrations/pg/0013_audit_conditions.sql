ALTER TABLE "crawl_url_audit" ADD COLUMN "noindex_requirement" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "noindex_rule" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "noindex_observed" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "nofollow_requirement" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "nofollow_rule" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "nofollow_observed" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "robots_requirement" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "robots_rule" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "robots_observed" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "sitemap_requirement" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "sitemap_rule" text;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "sitemap_observed" text;