CREATE TABLE `crawl_sitemap_hreflang` (
	`crawl_id` varchar(36) NOT NULL,
	`page_hash` varchar(32) NOT NULL,
	`lang` varchar(35) NOT NULL,
	`target_hash` varchar(32) NOT NULL,
	`url` text NOT NULL,
	CONSTRAINT `crawl_sitemap_hreflang_crawl_id_page_hash_lang_target_hash_pk` PRIMARY KEY(`crawl_id`,`page_hash`,`lang`,`target_hash`)
);
--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `issue_threshold` varchar(16) DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_url_issues` ADD `details` longtext;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_issue_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_warning_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_worst_opportunity_count` int;--> statement-breakpoint
ALTER TABLE `crawl_sitemap_hreflang` ADD CONSTRAINT `crawl_sitemap_hreflang_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;