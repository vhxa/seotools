CREATE TABLE `crawl_answer_pairs` (
	`crawl_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`detail` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `source_hash`),
	FOREIGN KEY (`crawl_id`,`source_hash`) REFERENCES `crawl_urls`(`crawl_id`,`url_hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crawls` ADD `paired_summary` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `retry_after_until` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `admission_dropped` integer;