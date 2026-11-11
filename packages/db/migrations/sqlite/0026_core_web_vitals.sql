CREATE TABLE `crawl_url_vitals` (
	`crawl_id` text NOT NULL,
	`form_factor` text NOT NULL,
	`url_hash` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`lcp` real,
	`inp` real,
	`cls` real,
	`fcp` real,
	`ttfb` real,
	`tbt` real,
	`collected_at` integer NOT NULL,
	PRIMARY KEY(`crawl_id`, `form_factor`, `url_hash`, `source`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crawl_vitals` (
	`crawl_id` text NOT NULL,
	`form_factor` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`lcp` real,
	`inp` real,
	`cls` real,
	`fcp` real,
	`ttfb` real,
	`tbt` real,
	`collected_at` integer NOT NULL,
	PRIMARY KEY(`crawl_id`, `form_factor`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crawl_settings` ADD `collect_vitals` integer DEFAULT true NOT NULL;