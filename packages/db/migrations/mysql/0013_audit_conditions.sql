ALTER TABLE `crawl_url_audit` ADD `noindex_requirement` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `noindex_rule` varchar(36);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `noindex_observed` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `nofollow_requirement` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `nofollow_rule` varchar(36);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `nofollow_observed` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `robots_requirement` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `robots_rule` varchar(36);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `robots_observed` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `sitemap_requirement` varchar(16);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `sitemap_rule` varchar(36);--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `sitemap_observed` varchar(16);