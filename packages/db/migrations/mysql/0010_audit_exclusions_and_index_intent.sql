CREATE TABLE `audit_rules` (
	`id` varchar(36) NOT NULL,
	`domain_id` varchar(36) NOT NULL,
	`dimension` varchar(16) NOT NULL,
	`value` varchar(16) NOT NULL,
	`selector_kind` varchar(16) NOT NULL,
	`selector` text NOT NULL,
	`query_mode` varchar(16) NOT NULL,
	`query_value` text,
	`selector_hash` varchar(32) NOT NULL,
	`active_key` varchar(32),
	`reason` text,
	`enabled` boolean NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_rules_active_idx` UNIQUE(`domain_id`,`dimension`,`active_key`)
);
--> statement-breakpoint
CREATE TABLE `crawl_url_audit` (
	`crawl_id` varchar(36) NOT NULL,
	`url_hash` varchar(32) NOT NULL,
	`participation` varchar(16) NOT NULL,
	`participation_rule` varchar(36),
	`intent` varchar(16) NOT NULL,
	`intent_rule` varchar(36),
	`indexability` varchar(16) NOT NULL,
	`blockers` text,
	CONSTRAINT `crawl_url_audit_crawl_id_url_hash_pk` PRIMARY KEY(`crawl_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `domain_audit_config` (
	`domain_id` varchar(36) NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	`recompute_error` text,
	`recompute_error_version` int,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `domain_audit_config_domain_id` PRIMARY KEY(`domain_id`)
);
--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_audited_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_excluded_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_indexable_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_not_indexable_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_unknown_indexability_count` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `audit_version` int;--> statement-breakpoint
ALTER TABLE `crawls` ADD `audit_snapshot` longtext;--> statement-breakpoint
ALTER TABLE `audit_rules` ADD CONSTRAINT `audit_rules_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD CONSTRAINT `crawl_url_audit_crawl_id_crawls_id_fk` FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `domain_audit_config` ADD CONSTRAINT `domain_audit_config_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_rules_domain_idx` ON `audit_rules` (`domain_id`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_participation_idx` ON `crawl_url_audit` (`crawl_id`,`participation`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_intent_idx` ON `crawl_url_audit` (`crawl_id`,`intent`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_participation_rule_idx` ON `crawl_url_audit` (`crawl_id`,`participation_rule`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_intent_rule_idx` ON `crawl_url_audit` (`crawl_id`,`intent_rule`);