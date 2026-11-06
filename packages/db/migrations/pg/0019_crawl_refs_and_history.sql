CREATE TABLE "crawl_url_history" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"status_code" integer,
	"redirect_to" text,
	"title" text,
	"canonical" text,
	"meta_robots" text,
	"x_robots_tag" text,
	"error" text,
	"depth" integer NOT NULL,
	"issues" text,
	"accepted" text,
	"audit" text,
	CONSTRAINT "crawl_url_history_crawl_id_url_hash_pk" PRIMARY KEY("crawl_id","url_hash")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "history_days" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "crawl_urls" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "crawl_urls" ADD COLUMN "found_from" integer;--> statement-breakpoint
ALTER TABLE "crawl_urls" ADD COLUMN "found_kind" text;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "ref" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_url_history" ADD CONSTRAINT "crawl_url_history_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_url_history_hash_idx" ON "crawl_url_history" USING btree ("url_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_urls_seq_idx" ON "crawl_urls" USING btree ("crawl_id","seq");--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_ref_unique" UNIQUE("ref");