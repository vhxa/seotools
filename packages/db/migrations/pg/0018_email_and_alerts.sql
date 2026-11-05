CREATE TABLE "alert_notices" (
	"crawl_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_notices_crawl_id_user_id_kind_pk" PRIMARY KEY("crawl_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "alert_subscriptions" (
	"user_id" text NOT NULL,
	"domain_id" text NOT NULL,
	"crawl_problem" boolean DEFAULT false NOT NULL,
	"important_findings" boolean DEFAULT false NOT NULL,
	"change_summary" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_subscriptions_user_id_domain_id_pk" PRIMARY KEY("user_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "mail_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_notices" ADD CONSTRAINT "alert_notices_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notices" ADD CONSTRAINT "alert_notices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_subscriptions_domain_idx" ON "alert_subscriptions" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "mail_deliveries_created_idx" ON "mail_deliveries" USING btree ("created_at");