CREATE TABLE `domain_favicons` (
	`domain_id` varchar(36) NOT NULL,
	`content_type` varchar(100),
	`data` longtext,
	`hash` varchar(64),
	`source_url` text,
	`next_check_at` datetime(3) NOT NULL,
	CONSTRAINT `domain_favicons_domain_id` PRIMARY KEY(`domain_id`)
);
--> statement-breakpoint
ALTER TABLE `domain_favicons` ADD CONSTRAINT `domain_favicons_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `domain_favicons_due_idx` ON `domain_favicons` (`next_check_at`);