ALTER TABLE "crawls" ADD COLUMN "pages_with_issue_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_with_warning_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_with_opportunity_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "issue_catalog" text;