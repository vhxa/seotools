CREATE TABLE `crawl_url_renders` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`status` text NOT NULL,
	`settled` integer NOT NULL,
	`final_url` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`failure` text,
	`data` text NOT NULL,
	PRIMARY KEY(`crawl_id`, `url_hash`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `render_wait_ms` integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `render_omitted_hosts` text;--> statement-breakpoint
ALTER TABLE `crawl_url_links` ADD `rendered` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `rendering` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `browser_wait_ms` integer DEFAULT 0 NOT NULL;