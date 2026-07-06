CREATE TABLE `update_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_update` integer DEFAULT false NOT NULL,
	`last_auto_check_at` integer
);
--> statement-breakpoint
ALTER TABLE `deployment_config` ADD `last_known_public_url` text;--> statement-breakpoint
ALTER TABLE `deployment_config` ADD `public_url_changed_at` integer;--> statement-breakpoint
ALTER TABLE `deployment_config` ADD `previous_public_url` text;