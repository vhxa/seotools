CREATE TABLE "incident_notices" (
	"incident_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "incident_notices_incident_id_user_id_stage_pk" PRIMARY KEY("incident_id","user_id","stage")
);
--> statement-breakpoint
CREATE TABLE "site_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"stage" text NOT NULL,
	"active_key" text,
	"opened_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"details" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD COLUMN "site_files" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD COLUMN "site_availability" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD COLUMN "vitals_regression" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_files" ADD COLUMN "incident_observed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_notices" ADD CONSTRAINT "incident_notices_incident_id_site_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."site_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_notices" ADD CONSTRAINT "incident_notices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_incidents" ADD CONSTRAINT "site_incidents_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_incidents_active_idx" ON "site_incidents" USING btree ("domain_id","active_key");--> statement-breakpoint
CREATE INDEX "site_incidents_domain_idx" ON "site_incidents" USING btree ("domain_id","opened_at");