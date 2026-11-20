CREATE TABLE "crawl_answer_pairs" (
	"crawl_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"detail" text NOT NULL,
	CONSTRAINT "crawl_answer_pairs_crawl_id_source_hash_pk" PRIMARY KEY("crawl_id","source_hash")
);
--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "paired_summary" text;--> statement-breakpoint
ALTER TABLE "crawl_answer_pairs" ADD CONSTRAINT "crawl_answer_pairs_crawl_id_source_hash_crawl_urls_crawl_id_url_hash_fk" FOREIGN KEY ("crawl_id","source_hash") REFERENCES "public"."crawl_urls"("crawl_id","url_hash") ON DELETE cascade ON UPDATE no action;