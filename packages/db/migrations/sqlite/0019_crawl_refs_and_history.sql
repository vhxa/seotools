CREATE TABLE `crawl_url_history` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`kind` text NOT NULL,
	`status_code` integer,
	`redirect_to` text,
	`title` text,
	`canonical` text,
	`meta_robots` text,
	`x_robots_tag` text,
	`error` text,
	`depth` integer NOT NULL,
	`issues` text,
	`accepted` text,
	`audit` text,
	PRIMARY KEY(`crawl_id`, `url_hash`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_url_history_hash_idx` ON `crawl_url_history` (`url_hash`);--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `history_days` integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE `crawl_urls` ADD `seq` integer;--> statement-breakpoint
ALTER TABLE `crawl_urls` ADD `found_from` integer;--> statement-breakpoint
ALTER TABLE `crawl_urls` ADD `found_kind` text;--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_urls_seq_idx` ON `crawl_urls` (`crawl_id`,`seq`);--> statement-breakpoint
ALTER TABLE `crawls` ADD `ref` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `history` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `crawls_ref_unique` ON `crawls` (`ref`);