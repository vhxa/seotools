CREATE TABLE `crawl_url_accepted_issues` (
	`crawl_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`issue` varchar(64) NOT NULL,
	`accepted_by` varchar(32) NOT NULL,
	`details` longtext NOT NULL,
	CONSTRAINT `crawl_url_accepted_issues_crawl_id_url_hash_issue_accepted_by_pk` PRIMARY KEY(`crawl_id`,`url_hash`,`issue`,`accepted_by`)
);
--> statement-breakpoint
ALTER TABLE `crawl_url_accepted_issues` ADD CONSTRAINT `crawl_url_accepted_issues_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crawl_url_accepted_issues_issue_idx` ON `crawl_url_accepted_issues` (`crawl_id`,`issue`);--> statement-breakpoint
CREATE INDEX `crawl_url_accepted_issues_by_idx` ON `crawl_url_accepted_issues` (`crawl_id`,`accepted_by`);