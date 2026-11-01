CREATE TABLE `crawl_links` (
	`crawl_id` varchar(36) NOT NULL,
	`source_hash` varchar(32) NOT NULL,
	`target_hash` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	CONSTRAINT `crawl_links_crawl_id_source_hash_target_hash_kind_pk` PRIMARY KEY(`crawl_id`,`source_hash`,`target_hash`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `crawl_schedules` (
	`id` varchar(36) NOT NULL,
	`domain_id` varchar(36) NOT NULL,
	`type` varchar(16) NOT NULL,
	`enabled` boolean NOT NULL,
	`frequency` varchar(16) NOT NULL,
	`hour` int NOT NULL,
	`minute` int NOT NULL,
	`day_of_week` int NOT NULL,
	`day_of_month` int NOT NULL,
	`time_zone` varchar(100) NOT NULL,
	`next_run_at` datetime(3) NOT NULL,
	`last_run_at` datetime(3),
	`last_outcome` varchar(16),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crawl_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `crawl_schedules_domain_type_idx` UNIQUE(`domain_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `crawl_settings` (
	`domain_id` varchar(36) NOT NULL,
	`rendering_mode` varchar(16) NOT NULL DEFAULT 'http',
	`user_agent` varchar(255),
	`concurrency` int NOT NULL,
	`requests_per_second` int NOT NULL,
	`timeout_ms` int NOT NULL,
	`max_retries` int NOT NULL,
	`max_urls` int,
	`retain_crawls` int,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crawl_settings_domain_id` PRIMARY KEY(`domain_id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_urls` (
	`crawl_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`url` text NOT NULL,
	`scope` varchar(16) NOT NULL,
	`state` varchar(16) NOT NULL,
	`kind` varchar(16) NOT NULL DEFAULT 'unknown',
	`source` varchar(16) NOT NULL,
	`depth` int NOT NULL,
	`status_code` int,
	`content_type` varchar(255),
	`redirect_to` text,
	`title` text,
	`meta_robots` text,
	`x_robots_tag` text,
	`canonical` text,
	`response_time_ms` int,
	`bytes` int,
	`error` text,
	`data` longtext,
	`fetched_at` datetime(3),
	CONSTRAINT `crawl_urls_crawl_id_url_hash_pk` PRIMARY KEY(`crawl_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `crawls` (
	`id` varchar(36) NOT NULL,
	`domain_id` varchar(36) NOT NULL,
	`type` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`trigger` varchar(16) NOT NULL,
	`job_id` varchar(36) NOT NULL,
	`active_key` varchar(36),
	`pages_count` int NOT NULL DEFAULT 0,
	`urls_count` int NOT NULL DEFAULT 0,
	`urls_done_count` int NOT NULL DEFAULT 0,
	`external_count` int NOT NULL DEFAULT 0,
	`robots` longtext,
	`pruned` boolean NOT NULL DEFAULT false,
	`error` text,
	`created_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	CONSTRAINT `crawls_id` PRIMARY KEY(`id`),
	CONSTRAINT `crawls_active_key_unique` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE TABLE `priority_urls` (
	`domain_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`url` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `priority_urls_domain_id_url_hash_pk` PRIMARY KEY(`domain_id`,`url_hash`)
);
--> statement-breakpoint
ALTER TABLE `crawl_links` ADD CONSTRAINT `crawl_links_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawl_schedules` ADD CONSTRAINT `crawl_schedules_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD CONSTRAINT `crawl_settings_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawl_urls` ADD CONSTRAINT `crawl_urls_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawls` ADD CONSTRAINT `crawls_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `priority_urls` ADD CONSTRAINT `priority_urls_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crawl_links_target_idx` ON `crawl_links` (`crawl_id`,`target_hash`);--> statement-breakpoint
CREATE INDEX `crawl_schedules_due_idx` ON `crawl_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `crawl_urls_queue_idx` ON `crawl_urls` (`crawl_id`,`state`,`depth`);--> statement-breakpoint
CREATE INDEX `crawl_urls_view_idx` ON `crawl_urls` (`crawl_id`,`scope`,`kind`,`depth`);--> statement-breakpoint
CREATE INDEX `crawl_urls_hash_idx` ON `crawl_urls` (`url_hash`);--> statement-breakpoint
CREATE INDEX `crawls_domain_created_idx` ON `crawls` (`domain_id`,`type`,`created_at`);