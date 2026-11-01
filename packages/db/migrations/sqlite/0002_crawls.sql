CREATE TABLE `crawl_links` (
	`crawl_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `source_hash`, `target_hash`, `kind`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_links_target_idx` ON `crawl_links` (`crawl_id`,`target_hash`);--> statement-breakpoint
CREATE TABLE `crawl_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer NOT NULL,
	`frequency` text NOT NULL,
	`hour` integer NOT NULL,
	`minute` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`day_of_month` integer NOT NULL,
	`time_zone` text NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`last_outcome` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_schedules_domain_type_idx` ON `crawl_schedules` (`domain_id`,`type`);--> statement-breakpoint
CREATE INDEX `crawl_schedules_due_idx` ON `crawl_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `crawl_settings` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`rendering_mode` text DEFAULT 'http' NOT NULL,
	`user_agent` text,
	`concurrency` integer NOT NULL,
	`requests_per_second` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`max_retries` integer NOT NULL,
	`max_urls` integer,
	`retain_crawls` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crawl_urls` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`source` text NOT NULL,
	`depth` integer NOT NULL,
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
	`data` text,
	`fetched_at` integer,
	PRIMARY KEY(`crawl_id`, `url_hash`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_urls_queue_idx` ON `crawl_urls` (`crawl_id`,`state`,`depth`);--> statement-breakpoint
CREATE INDEX `crawl_urls_view_idx` ON `crawl_urls` (`crawl_id`,`scope`,`kind`,`depth`);--> statement-breakpoint
CREATE INDEX `crawl_urls_hash_idx` ON `crawl_urls` (`url_hash`);--> statement-breakpoint
CREATE TABLE `crawls` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`trigger` text NOT NULL,
	`job_id` text NOT NULL,
	`active_key` text,
	`pages_count` integer DEFAULT 0 NOT NULL,
	`urls_count` integer DEFAULT 0 NOT NULL,
	`urls_done_count` integer DEFAULT 0 NOT NULL,
	`external_count` integer DEFAULT 0 NOT NULL,
	`robots` text,
	`pruned` integer DEFAULT false NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crawls_active_key_unique` ON `crawls` (`active_key`);--> statement-breakpoint
CREATE INDEX `crawls_domain_created_idx` ON `crawls` (`domain_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `priority_urls` (
	`domain_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`domain_id`, `url_hash`),
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
