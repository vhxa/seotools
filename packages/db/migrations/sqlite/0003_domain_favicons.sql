CREATE TABLE `domain_favicons` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`content_type` text,
	`data` text,
	`hash` text,
	`source_url` text,
	`next_check_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `domain_favicons_due_idx` ON `domain_favicons` (`next_check_at`);