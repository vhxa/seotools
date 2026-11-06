CREATE TABLE "crawl_url_links" (
	"crawl_ref" integer NOT NULL,
	"source" integer NOT NULL,
	"target" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"element" text,
	"region" text,
	"snippet" text,
	CONSTRAINT "crawl_url_links_crawl_ref_source_target_kind_pk" PRIMARY KEY("crawl_ref","source","target","kind")
);
--> statement-breakpoint
ALTER TABLE "crawl_url_links" ADD CONSTRAINT "crawl_url_links_crawl_ref_crawls_ref_fk" FOREIGN KEY ("crawl_ref") REFERENCES "public"."crawls"("ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_url_links_target_idx" ON "crawl_url_links" USING btree ("crawl_ref","target");