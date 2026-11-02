CREATE TABLE `crawl_sitemap_hreflang` (
	`crawl_id` text NOT NULL,
	`page_hash` text NOT NULL,
	`lang` text NOT NULL,
	`target_hash` text NOT NULL,
	`url` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `page_hash`, `lang`, `target_hash`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `issue_threshold` text DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_url_issues` ADD `details` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_issue_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_warning_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_opportunity_count` integer;