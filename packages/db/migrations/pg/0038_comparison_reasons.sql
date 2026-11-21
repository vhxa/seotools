CREATE TABLE "crawl_comparison_urls" (
	"base_ref" integer NOT NULL,
	"target_ref" integer NOT NULL,
	"url_hash" text NOT NULL,
	"side" text NOT NULL,
	"seq" integer,
	"reason" text NOT NULL,
	"detail" text,
	"via" integer,
	"via_kind" text,
	"via_rendered" integer,
	"through" integer,
	"sources" integer DEFAULT 0 NOT NULL,
	"unseen" integer DEFAULT 0 NOT NULL,
	"into_hash" text,
	"into_url" text,
	"into_present" boolean,
	CONSTRAINT "crawl_comparison_urls_base_ref_target_ref_url_hash_pk" PRIMARY KEY("base_ref","target_ref","url_hash")
);
--> statement-breakpoint
CREATE TABLE "crawl_comparisons" (
	"base_ref" integer NOT NULL,
	"target_ref" integer NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"runner" text,
	"job_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	CONSTRAINT "crawl_comparisons_base_ref_target_ref_pk" PRIMARY KEY("base_ref","target_ref")
);
--> statement-breakpoint
ALTER TABLE "crawl_comparison_urls" ADD CONSTRAINT "crawl_comparison_urls_base_ref_crawls_ref_fk" FOREIGN KEY ("base_ref") REFERENCES "public"."crawls"("ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_comparison_urls" ADD CONSTRAINT "crawl_comparison_urls_target_ref_crawls_ref_fk" FOREIGN KEY ("target_ref") REFERENCES "public"."crawls"("ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_comparisons" ADD CONSTRAINT "crawl_comparisons_base_ref_crawls_ref_fk" FOREIGN KEY ("base_ref") REFERENCES "public"."crawls"("ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_comparisons" ADD CONSTRAINT "crawl_comparisons_target_ref_crawls_ref_fk" FOREIGN KEY ("target_ref") REFERENCES "public"."crawls"("ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_comparison_urls_reason_idx" ON "crawl_comparison_urls" USING btree ("base_ref","target_ref","side","reason");--> statement-breakpoint
CREATE INDEX "crawl_comparison_urls_target_idx" ON "crawl_comparison_urls" USING btree ("target_ref");--> statement-breakpoint
CREATE INDEX "crawl_comparisons_target_idx" ON "crawl_comparisons" USING btree ("target_ref");