CREATE TABLE "finding_states" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"issue" text NOT NULL,
	"url_hash" text,
	"target_key" text NOT NULL,
	"state" text NOT NULL,
	"note" text NOT NULL,
	"set_by" text,
	"set_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_states" ADD CONSTRAINT "finding_states_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_states" ADD CONSTRAINT "finding_states_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_states_target_idx" ON "finding_states" USING btree ("domain_id","issue","target_key");