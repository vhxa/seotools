CREATE TABLE "crawl_url_vitals" (
	"crawl_id" text NOT NULL,
	"form_factor" text NOT NULL,
	"url_hash" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"lcp" double precision,
	"inp" double precision,
	"cls" double precision,
	"fcp" double precision,
	"ttfb" double precision,
	"tbt" double precision,
	"collected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crawl_url_vitals_crawl_id_form_factor_url_hash_source_pk" PRIMARY KEY("crawl_id","form_factor","url_hash","source")
);
--> statement-breakpoint
CREATE TABLE "crawl_vitals" (
	"crawl_id" text NOT NULL,
	"form_factor" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"lcp" double precision,
	"inp" double precision,
	"cls" double precision,
	"fcp" double precision,
	"ttfb" double precision,
	"tbt" double precision,
	"collected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crawl_vitals_crawl_id_form_factor_pk" PRIMARY KEY("crawl_id","form_factor")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "collect_vitals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_url_vitals" ADD CONSTRAINT "crawl_url_vitals_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_vitals" ADD CONSTRAINT "crawl_vitals_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;