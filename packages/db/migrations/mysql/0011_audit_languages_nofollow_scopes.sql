ALTER TABLE `audit_rules` ADD `scope` varchar(16) DEFAULT 'literal' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_rules` ADD `accept_nofollow` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `accept_nofollow` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `domain_audit_config` ADD `language_prefixes` text;--> statement-breakpoint
ALTER TABLE `domain_audit_config` ADD `language_unprefixed` boolean DEFAULT false NOT NULL;