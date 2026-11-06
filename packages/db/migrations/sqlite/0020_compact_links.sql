CREATE TABLE `crawl_url_links` (
	`crawl_ref` integer NOT NULL,
	`source` integer NOT NULL,
	`target` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`element` text,
	`region` text,
	`snippet` text,
	PRIMARY KEY(`crawl_ref`, `source`, `target`, `kind`),
	FOREIGN KEY (`crawl_ref`) REFERENCES `crawls`(`ref`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_url_links_target_idx` ON `crawl_url_links` (`crawl_ref`,`target`);