CREATE TABLE `url_verification_urls` (
	`verification_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`state` text NOT NULL,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`status_code` integer,
	`content_type` text,
	`redirect_to` text,
	`title` text,
	`meta_robots` text,
	`x_robots_tag` text,
	`canonical` text,
	`response_time_ms` integer,
	`bytes` integer,
	`error` text,
	`audit_version` integer,
	`outcome` text,
	`fetched_at` integer,
	PRIMARY KEY(`verification_id`, `url_hash`),
	FOREIGN KEY (`verification_id`) REFERENCES `url_verifications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `url_verification_urls_queue_idx` ON `url_verification_urls` (`verification_id`,`state`);--> statement-breakpoint
CREATE INDEX `url_verification_urls_hash_idx` ON `url_verification_urls` (`url_hash`);--> statement-breakpoint
CREATE TABLE `url_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`job_id` text NOT NULL,
	`active_key` text,
	`base_crawl_id` text NOT NULL,
	`urls_count` integer DEFAULT 0 NOT NULL,
	`urls_done_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `url_verifications_active_key_unique` ON `url_verifications` (`active_key`);--> statement-breakpoint
CREATE INDEX `url_verifications_domain_created_idx` ON `url_verifications` (`domain_id`,`created_at`);