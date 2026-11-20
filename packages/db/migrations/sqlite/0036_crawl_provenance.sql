ALTER TABLE `crawls` ADD `started_build` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `run_builds` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `analysis_build` text;--> statement-breakpoint
ALTER TABLE `crawls` ADD `discovery_settings` text;--> statement-breakpoint
ALTER TABLE `worker_heartbeats` ADD `build` text;--> statement-breakpoint
ALTER TABLE `worker_heartbeats` ADD `outdated` integer;