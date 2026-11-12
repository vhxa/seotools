CREATE TABLE `bot_test_results` (
	`run_id` text NOT NULL,
	`bot_token` text NOT NULL,
	`status_code` integer,
	`final_url` text,
	`response_time_ms` integer,
	`bytes` integer,
	`error_code` text,
	`verdict` text NOT NULL,
	`reasons` text NOT NULL,
	PRIMARY KEY(`run_id`, `bot_token`),
	FOREIGN KEY (`run_id`) REFERENCES `bot_test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bot_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`job_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`active_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_test_runs_active_key_unique` ON `bot_test_runs` (`active_key`);