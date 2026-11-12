CREATE TABLE "bot_test_results" (
	"run_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"status_code" integer,
	"final_url" text,
	"response_time_ms" integer,
	"bytes" integer,
	"error_code" text,
	"verdict" text NOT NULL,
	"reasons" text NOT NULL,
	CONSTRAINT "bot_test_results_run_id_bot_token_pk" PRIMARY KEY("run_id","bot_token")
);
--> statement-breakpoint
CREATE TABLE "bot_test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"job_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"active_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bot_test_runs_active_key_unique" UNIQUE("active_key")
);
--> statement-breakpoint
ALTER TABLE "bot_test_results" ADD CONSTRAINT "bot_test_results_run_id_bot_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bot_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_test_runs" ADD CONSTRAINT "bot_test_runs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;