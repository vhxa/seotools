CREATE TABLE `crawl_url_issues` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`issue` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `url_hash`, `issue`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_url_issues_issue_idx` ON `crawl_url_issues` (`crawl_id`,`issue`);--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_with_issues_count` integer;