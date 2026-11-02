ALTER TABLE `crawls` ADD `pages_with_issue_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_with_warning_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_with_opportunity_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `issue_catalog` varchar(64);