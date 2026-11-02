ALTER TABLE `audit_rules` ADD `scope` text DEFAULT 'literal' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_rules` ADD `accept_nofollow` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_url_audit` ADD `accept_nofollow` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `domain_audit_config` ADD `language_prefixes` text;--> statement-breakpoint
ALTER TABLE `domain_audit_config` ADD `language_unprefixed` integer DEFAULT false NOT NULL;