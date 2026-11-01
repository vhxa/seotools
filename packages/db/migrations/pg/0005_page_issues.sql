CREATE TABLE "crawl_url_issues" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"issue" text NOT NULL,
	CONSTRAINT "crawl_url_issues_crawl_id_url_hash_issue_pk" PRIMARY KEY("crawl_id","url_hash","issue")
);
--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_with_issues_count" integer;--> statement-breakpoint
ALTER TABLE "crawl_url_issues" ADD CONSTRAINT "crawl_url_issues_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_url_issues_issue_idx" ON "crawl_url_issues" USING btree ("crawl_id","issue");