CREATE TABLE `incident_notices` (
	`incident_id` text NOT NULL,
	`user_id` text NOT NULL,
	`stage` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`incident_id`, `user_id`, `stage`),
	FOREIGN KEY (`incident_id`) REFERENCES `site_incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `site_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`stage` text NOT NULL,
	`active_key` text,
	`opened_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer,
	`details` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_incidents_active_idx` ON `site_incidents` (`domain_id`,`active_key`);--> statement-breakpoint
CREATE INDEX `site_incidents_domain_idx` ON `site_incidents` (`domain_id`,`opened_at`);--> statement-breakpoint
ALTER TABLE `alert_subscriptions` ADD `site_files` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_subscriptions` ADD `site_availability` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_subscriptions` ADD `vitals_regression` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_files` ADD `incident_observed` integer DEFAULT false NOT NULL;