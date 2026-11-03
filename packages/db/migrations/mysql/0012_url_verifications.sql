CREATE TABLE `url_verification_urls` (
	`verification_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`url` text NOT NULL,
	`source` varchar(16) NOT NULL,
	`state` varchar(16) NOT NULL,
	`kind` varchar(16) NOT NULL DEFAULT 'unknown',
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
	`audit_version` int,
	`outcome` longtext,
	`fetched_at` datetime(3),
	CONSTRAINT `url_verification_urls_verification_id_url_hash_pk` PRIMARY KEY(`verification_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `url_verifications` (
	`id` varchar(36) NOT NULL,
	`domain_id` varchar(36) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`job_id` varchar(36) NOT NULL,
	`active_key` varchar(36),
	`base_crawl_id` varchar(36) NOT NULL,
	`urls_count` int NOT NULL DEFAULT 0,
	`urls_done_count` int NOT NULL DEFAULT 0,
	`error` text,
	`created_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	CONSTRAINT `url_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `url_verifications_active_key_unique` UNIQUE(`active_key`)
);
--> statement-breakpoint
ALTER TABLE `url_verification_urls` ADD CONSTRAINT `url_verification_urls_verification_id_url_verifications_id_fk` FOREIGN KEY (`verification_id`) REFERENCES `url_verifications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `url_verifications` ADD CONSTRAINT `url_verifications_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `url_verification_urls_queue_idx` ON `url_verification_urls` (`verification_id`,`state`);--> statement-breakpoint
CREATE INDEX `url_verification_urls_hash_idx` ON `url_verification_urls` (`url_hash`);--> statement-breakpoint
CREATE INDEX `url_verifications_domain_created_idx` ON `url_verifications` (`domain_id`,`created_at`);