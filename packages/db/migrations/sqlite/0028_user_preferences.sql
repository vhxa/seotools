CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`favourite_domain_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`favourite_domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE set null
);
