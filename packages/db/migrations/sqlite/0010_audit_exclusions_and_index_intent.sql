CREATE TABLE `audit_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`selector_kind` text NOT NULL,
	`selector` text NOT NULL,
	`query_mode` text NOT NULL,
	`query_value` text,
	`selector_hash` text NOT NULL,
	`active_key` text,
	`reason` text,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_rules_domain_idx` ON `audit_rules` (`domain_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_rules_active_idx` ON `audit_rules` (`domain_id`,`dimension`,`active_key`);--> statement-breakpoint
CREATE TABLE `crawl_url_audit` (
	`crawl_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`participation` text NOT NULL,
	`participation_rule` text,
	`intent` text NOT NULL,
	`intent_rule` text,
	`indexability` text NOT NULL,
	`blockers` text,
	PRIMARY KEY(`crawl_id`, `url_hash`),
	FOREIGN KEY (`crawl_id`) REFERENCES `crawls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_url_audit_participation_idx` ON `crawl_url_audit` (`crawl_id`,`participation`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_intent_idx` ON `crawl_url_audit` (`crawl_id`,`intent`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_participation_rule_idx` ON `crawl_url_audit` (`crawl_id`,`participation_rule`);--> statement-breakpoint
CREATE INDEX `crawl_url_audit_intent_rule_idx` ON `crawl_url_audit` (`crawl_id`,`intent_rule`);--> statement-breakpoint
CREATE TABLE `domain_audit_config` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`recompute_error` text,
	`recompute_error_version` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_audited_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_excluded_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_indexable_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_not_indexable_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `pages_unknown_indexability_count` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `audit_version` integer;--> statement-breakpoint
ALTER TABLE `crawls` ADD `audit_snapshot` text;