CREATE TABLE `finding_states` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`issue` text NOT NULL,
	`url_hash` text,
	`target_key` text NOT NULL,
	`state` text NOT NULL,
	`note` text NOT NULL,
	`set_by` text,
	`set_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_states_target_idx` ON `finding_states` (`domain_id`,`issue`,`target_key`);