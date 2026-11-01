CREATE TABLE `crawl_url_issues` (
	`crawl_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`issue` varchar(64) NOT NULL,
	CONSTRAINT `crawl_url_issues_crawl_id_url_hash_issue_pk` PRIMARY KEY(`crawl_id`,`url_hash`,`issue`)
);
--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_with_issues_count` int;--> statement-breakpoint
ALTER TABLE `crawl_url_issues` ADD CONSTRAINT `crawl_url_issues_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crawl_url_issues_issue_idx` ON `crawl_url_issues` (`crawl_id`,`issue`);