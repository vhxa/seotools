CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"favourite_domain_id" text
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_favourite_domain_id_domains_id_fk" FOREIGN KEY ("favourite_domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;