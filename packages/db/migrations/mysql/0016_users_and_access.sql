CREATE TABLE `user_access` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`company_id` varchar(36),
	`domain_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `user_access_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_access_company_idx` UNIQUE(`user_id`,`company_id`),
	CONSTRAINT `user_access_domain_idx` UNIQUE(`user_id`,`domain_id`)
);
--> statement-breakpoint
CREATE TABLE `user_tokens` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `user_tokens_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `role` varchar(16) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled_at` datetime(3);--> statement-breakpoint
ALTER TABLE `user` ADD `reset_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `user_access` ADD CONSTRAINT `user_access_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_access` ADD CONSTRAINT `user_access_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_access` ADD CONSTRAINT `user_access_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_tokens` ADD CONSTRAINT `user_tokens_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `user_tokens_user_idx` ON `user_tokens` (`user_id`);