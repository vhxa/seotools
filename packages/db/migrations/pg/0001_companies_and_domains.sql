CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"host" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "domains_host_unique" UNIQUE("host")
);
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domains_company_id_idx" ON "domains" USING btree ("company_id");