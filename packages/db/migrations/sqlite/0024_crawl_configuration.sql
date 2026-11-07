ALTER TABLE `crawl_settings` ADD `include_prefixes` text;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `exclude_prefixes` text;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `max_depth` integer;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `request_secrets` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `seed_urls` text;