CREATE TABLE "url_verification_urls" (
	"verification_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"status_code" integer,
	"content_type" text,
	"redirect_to" text,
	"title" text,
	"meta_robots" text,
	"x_robots_tag" text,
	"canonical" text,
	"response_time_ms" integer,
	"bytes" integer,
	"error" text,
	"audit_version" integer,
	"outcome" text,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "url_verification_urls_verification_id_url_hash_pk" PRIMARY KEY("verification_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "url_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_id" text NOT NULL,
	"active_key" text,
	"base_crawl_id" text NOT NULL,
	"urls_count" integer DEFAULT 0 NOT NULL,
	"urls_done_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "url_verifications_active_key_unique" UNIQUE("active_key")
);
--> statement-breakpoint
ALTER TABLE "url_verification_urls" ADD CONSTRAINT "url_verification_urls_verification_id_url_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."url_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_verifications" ADD CONSTRAINT "url_verifications_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "url_verification_urls_queue_idx" ON "url_verification_urls" USING btree ("verification_id","state");--> statement-breakpoint
CREATE INDEX "url_verification_urls_hash_idx" ON "url_verification_urls" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "url_verifications_domain_created_idx" ON "url_verifications" USING btree ("domain_id","created_at");