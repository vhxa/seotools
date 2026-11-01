CREATE TABLE "crawl_links" (
	"crawl_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"target_hash" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "crawl_links_crawl_id_source_hash_target_hash_kind_pk" PRIMARY KEY("crawl_id","source_hash","target_hash","kind")
);
--> statement-breakpoint
CREATE TABLE "crawl_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean NOT NULL,
	"frequency" text NOT NULL,
	"hour" integer NOT NULL,
	"minute" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"day_of_month" integer NOT NULL,
	"time_zone" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_outcome" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_settings" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"rendering_mode" text DEFAULT 'http' NOT NULL,
	"user_agent" text,
	"concurrency" integer NOT NULL,
	"requests_per_second" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"max_retries" integer NOT NULL,
	"max_urls" integer,
	"retain_crawls" integer,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_urls" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"scope" text NOT NULL,
	"state" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"source" text NOT NULL,
	"depth" integer NOT NULL,
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
	"data" text,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "crawl_urls_crawl_id_url_hash_pk" PRIMARY KEY("crawl_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "crawls" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text NOT NULL,
	"job_id" text NOT NULL,
	"active_key" text,
	"pages_count" integer DEFAULT 0 NOT NULL,
	"urls_count" integer DEFAULT 0 NOT NULL,
	"urls_done_count" integer DEFAULT 0 NOT NULL,
	"external_count" integer DEFAULT 0 NOT NULL,
	"robots" text,
	"pruned" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "crawls_active_key_unique" UNIQUE("active_key")
);
--> statement-breakpoint
CREATE TABLE "priority_urls" (
	"domain_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "priority_urls_domain_id_url_hash_pk" PRIMARY KEY("domain_id","url_hash")
);
--> statement-breakpoint
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_schedules" ADD CONSTRAINT "crawl_schedules_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD CONSTRAINT "crawl_settings_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_urls" ADD CONSTRAINT "crawl_urls_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_urls" ADD CONSTRAINT "priority_urls_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_links_target_idx" ON "crawl_links" USING btree ("crawl_id","target_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_schedules_domain_type_idx" ON "crawl_schedules" USING btree ("domain_id","type");--> statement-breakpoint
CREATE INDEX "crawl_schedules_due_idx" ON "crawl_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "crawl_urls_queue_idx" ON "crawl_urls" USING btree ("crawl_id","state","depth");--> statement-breakpoint
CREATE INDEX "crawl_urls_view_idx" ON "crawl_urls" USING btree ("crawl_id","scope","kind","depth");--> statement-breakpoint
CREATE INDEX "crawl_urls_hash_idx" ON "crawl_urls" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "crawls_domain_created_idx" ON "crawls" USING btree ("domain_id","type","created_at");