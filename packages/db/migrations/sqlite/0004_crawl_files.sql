CREATE TABLE `crawl_file_checks` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`next_check_at` integer NOT NULL,
	`requested_at` integer,
	`checked_at` integer,
	`outcome` text,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_file_checks_due_idx` ON `crawl_file_checks` (`next_check_at`);--> statement-breakpoint
CREATE TABLE `crawl_files` (
	`domain_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`status_code` integer,
	`content_type` text,
	`redirect_to` text,
	`bytes` integer,
	`truncated` integer DEFAULT false NOT NULL,
	`body` text,
	`error` text,
	`data` text,
	`via` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`domain_id`, `url_hash`),
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_files_kind_idx` ON `crawl_files` (`domain_id`,`kind`);--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `optional_files` text;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `index_now_key` text;