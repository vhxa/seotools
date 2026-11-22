CREATE TABLE `crawl_comparison_urls` (
	`base_ref` integer NOT NULL,
	`target_ref` integer NOT NULL,
	`url_hash` text NOT NULL,
	`side` text NOT NULL,
	`seq` integer,
	`reason` text NOT NULL,
	`detail` text,
	`via` integer,
	`via_kind` text,
	`via_rendered` integer,
	`through` integer,
	`sources` integer DEFAULT 0 NOT NULL,
	`unseen` integer DEFAULT 0 NOT NULL,
	`into_hash` text,
	`into_url` text,
	`into_present` integer,
	PRIMARY KEY(`base_ref`, `target_ref`, `url_hash`),
	FOREIGN KEY (`base_ref`) REFERENCES `crawls`(`ref`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_ref`) REFERENCES `crawls`(`ref`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_comparison_urls_reason_idx` ON `crawl_comparison_urls` (`base_ref`,`target_ref`,`side`,`reason`);--> statement-breakpoint
CREATE INDEX `crawl_comparison_urls_target_idx` ON `crawl_comparison_urls` (`target_ref`);--> statement-breakpoint
CREATE TABLE `crawl_comparisons` (
	`base_ref` integer NOT NULL,
	`target_ref` integer NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`runner` text,
	`job_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	PRIMARY KEY(`base_ref`, `target_ref`),
	FOREIGN KEY (`base_ref`) REFERENCES `crawls`(`ref`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_ref`) REFERENCES `crawls`(`ref`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_comparisons_target_idx` ON `crawl_comparisons` (`target_ref`);