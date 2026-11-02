CREATE TABLE "audit_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"selector_kind" text NOT NULL,
	"selector" text NOT NULL,
	"query_mode" text NOT NULL,
	"query_value" text,
	"selector_hash" text NOT NULL,
	"active_key" text,
	"reason" text,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_url_audit" (
	"crawl_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"participation" text NOT NULL,
	"participation_rule" text,
	"intent" text NOT NULL,
	"intent_rule" text,
	"indexability" text NOT NULL,
	"blockers" text,
	CONSTRAINT "crawl_url_audit_crawl_id_url_hash_pk" PRIMARY KEY("crawl_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "domain_audit_config" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"recompute_error" text,
	"recompute_error_version" integer,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_audited_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_excluded_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_indexable_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_not_indexable_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "pages_unknown_indexability_count" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "audit_version" integer;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "audit_snapshot" text;--> statement-breakpoint
ALTER TABLE "audit_rules" ADD CONSTRAINT "audit_rules_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD CONSTRAINT "crawl_url_audit_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_audit_config" ADD CONSTRAINT "domain_audit_config_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_rules_domain_idx" ON "audit_rules" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_rules_active_idx" ON "audit_rules" USING btree ("domain_id","dimension","active_key");--> statement-breakpoint
CREATE INDEX "crawl_url_audit_participation_idx" ON "crawl_url_audit" USING btree ("crawl_id","participation");--> statement-breakpoint
CREATE INDEX "crawl_url_audit_intent_idx" ON "crawl_url_audit" USING btree ("crawl_id","intent");--> statement-breakpoint
CREATE INDEX "crawl_url_audit_participation_rule_idx" ON "crawl_url_audit" USING btree ("crawl_id","participation_rule");--> statement-breakpoint
CREATE INDEX "crawl_url_audit_intent_rule_idx" ON "crawl_url_audit" USING btree ("crawl_id","intent_rule");