CREATE TABLE "domain_favicons" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"content_type" text,
	"data" text,
	"hash" text,
	"source_url" text,
	"next_check_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_favicons" ADD CONSTRAINT "domain_favicons_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_favicons_due_idx" ON "domain_favicons" USING btree ("next_check_at");