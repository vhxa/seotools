CREATE TABLE `crawl_file_checks` (
	`domain_id` varchar(36) NOT NULL,
	`next_check_at` datetime(3) NOT NULL,
	`requested_at` datetime(3),
	`checked_at` datetime(3),
	`outcome` varchar(16),
	CONSTRAINT `crawl_file_checks_domain_id` PRIMARY KEY(`domain_id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_files` (
	`domain_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`url` text NOT NULL,
	`kind` varchar(32) NOT NULL,
	`status_code` int,
	`content_type` varchar(255),
	`redirect_to` text,
	`bytes` int,
	`truncated` boolean NOT NULL DEFAULT false,
	`body` longtext,
	`error` text,
	`data` longtext,
	`via` varchar(16) NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	CONSTRAINT `crawl_files_domain_id_url_hash_pk` PRIMARY KEY(`domain_id`,`url_hash`)
);
--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `optional_files` longtext;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `index_now_key` varchar(128);--> statement-breakpoint
ALTER TABLE `crawl_file_checks` ADD CONSTRAINT `crawl_file_checks_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawl_files` ADD CONSTRAINT `crawl_files_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crawl_file_checks_due_idx` ON `crawl_file_checks` (`next_check_at`);--> statement-breakpoint
CREATE INDEX `crawl_files_kind_idx` ON `crawl_files` (`domain_id`,`kind`);