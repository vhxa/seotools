ALTER TABLE `crawls` ADD `capacity_metrics` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `site_slowdown` integer;--> statement-breakpoint
ALTER TABLE `domains` ADD `capacity_generation` text;--> statement-breakpoint
ALTER TABLE `user` ADD `capacity_generation` text;