CREATE TABLE `alert_notices` (
	`crawl_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `alert_notices_crawl_id_user_id_kind_pk` PRIMARY KEY(`crawl_id`,`user_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `alert_subscriptions` (
	`user_id` varchar(36) NOT NULL,
	`domain_id` varchar(36) NOT NULL,
	`crawl_problem` boolean NOT NULL DEFAULT false,
	`important_findings` boolean NOT NULL DEFAULT false,
	`change_summary` boolean NOT NULL DEFAULT false,
	`locale` varchar(8) NOT NULL DEFAULT 'en',
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `alert_subscriptions_user_id_domain_id_pk` PRIMARY KEY(`user_id`,`domain_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_deliveries` (
	`id` varchar(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`recipient` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL,
	`error` text,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `mail_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `alert_notices` ADD CONSTRAINT `alert_notices_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_notices` ADD CONSTRAINT `alert_notices_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_subscriptions` ADD CONSTRAINT `alert_subscriptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_subscriptions` ADD CONSTRAINT `alert_subscriptions_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `alert_subscriptions_domain_idx` ON `alert_subscriptions` (`domain_id`);--> statement-breakpoint
CREATE INDEX `mail_deliveries_created_idx` ON `mail_deliveries` (`created_at`);