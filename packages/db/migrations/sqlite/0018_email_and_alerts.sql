CREATE TABLE `alert_notices` (
	`crawl_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`crawl_id`, `user_id`, `kind`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `alert_subscriptions` (
	`user_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`crawl_problem` integer DEFAULT false NOT NULL,
	`important_findings` integer DEFAULT false NOT NULL,
	`change_summary` integer DEFAULT false NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `domain_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_subscriptions_domain_idx` ON `alert_subscriptions` (`domain_id`);--> statement-breakpoint
CREATE TABLE `mail_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_deliveries_created_idx` ON `mail_deliveries` (`created_at`);