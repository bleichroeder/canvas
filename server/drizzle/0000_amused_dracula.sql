CREATE TABLE `pair_sessions` (
	`code` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pair_sessions_expires` ON `pair_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `source_status_cache` (
	`source_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_seen_at` integer,
	`expires_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_status_cache_expires` ON `source_status_cache` (`expires_at`);