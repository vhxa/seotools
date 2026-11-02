ALTER TABLE "audit_rules" ADD COLUMN "scope" text DEFAULT 'literal' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_rules" ADD COLUMN "accept_nofollow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_url_audit" ADD COLUMN "accept_nofollow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_audit_config" ADD COLUMN "language_prefixes" text;--> statement-breakpoint
ALTER TABLE "domain_audit_config" ADD COLUMN "language_unprefixed" boolean DEFAULT false NOT NULL;