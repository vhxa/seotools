CREATE TABLE "crawl_sitemap_hreflang" (
	"crawl_id" text NOT NULL,
	"page_hash" text NOT NULL,
	"lang" text NOT NULL,
	"target_hash" text NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "crawl_sitemap_hreflang_crawl_id_page_hash_lang_target_hash_pk" PRIMARY KEY("crawl_id","page_hash","lang","target_hash")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "issue_threshold" text DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_url_issues" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_worst_issue_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_worst_warning_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_worst_opportunity_count" integer;--> statement-breakpoint
ALTER TABLE "crawl_sitemap_hreflang" ADD CONSTRAINT "crawl_sitemap_hreflang_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;