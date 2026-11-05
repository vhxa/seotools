CREATE TABLE "crawl_url_accepted_issues" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"issue" text NOT NULL,
	"accepted_by" text NOT NULL,
	"details" text NOT NULL,
	CONSTRAINT "crawl_url_accepted_issues_crawl_id_url_hash_issue_accepted_by_pk" PRIMARY KEY("crawl_id","url_hash","issue","accepted_by")
);
--> statement-breakpoint
ALTER TABLE "crawl_url_accepted_issues" ADD CONSTRAINT "crawl_url_accepted_issues_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_url_accepted_issues_issue_idx" ON "crawl_url_accepted_issues" USING btree ("crawl_id","issue");--> statement-breakpoint
CREATE INDEX "crawl_url_accepted_issues_by_idx" ON "crawl_url_accepted_issues" USING btree ("crawl_id","accepted_by");