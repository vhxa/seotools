CREATE TABLE "crawl_url_renders" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"status" text NOT NULL,
	"settled" boolean NOT NULL,
	"final_url" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"failure" text,
	"data" text NOT NULL,
	CONSTRAINT "crawl_url_renders_crawl_id_url_hash_pk" PRIMARY KEY("crawl_id","url_hash")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "render_wait_ms" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "render_omitted_hosts" text;--> statement-breakpoint
ALTER TABLE "crawl_url_links" ADD COLUMN "rendered" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "rendering" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "browser_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_url_renders" ADD CONSTRAINT "crawl_url_renders_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;