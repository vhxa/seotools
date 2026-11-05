CREATE TABLE `crawl_url_accepted_issues` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`issue` text NOT NULL,
	`accepted_by` text NOT NULL,
	`details` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `url_hash`, `issue`, `accepted_by`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_url_accepted_issues_issue_idx` ON `crawl_url_accepted_issues` (`crawl_id`,`issue`);--> statement-breakpoint
CREATE INDEX `crawl_url_accepted_issues_by_idx` ON `crawl_url_accepted_issues` (`crawl_id`,`accepted_by`);