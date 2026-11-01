CREATE TABLE `companies` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`host` varchar(253) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `domains_id` PRIMARY KEY(`id`),
	CONSTRAINT `domains_host_unique` UNIQUE(`host`)
);
--> statement-breakpoint
ALTER TABLE `domains` ADD CONSTRAINT `domains_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `domains_company_id_idx` ON `domains` (`company_id`);