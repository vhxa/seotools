CREATE TABLE "crawl_file_checks" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "crawl_files" (
	"domain_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"status_code" integer,
	"content_type" text,
	"redirect_to" text,
	"bytes" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"body" text,
	"error" text,
	"data" text,
	"via" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crawl_files_domain_id_url_hash_pk" PRIMARY KEY("domain_id","url_hash")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "optional_files" text;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "index_now_key" text;--> statement-breakpoint
ALTER TABLE "crawl_file_checks" ADD CONSTRAINT "crawl_file_checks_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_files" ADD CONSTRAINT "crawl_files_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_file_checks_due_idx" ON "crawl_file_checks" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "crawl_files_kind_idx" ON "crawl_files" USING btree ("domain_id","kind");