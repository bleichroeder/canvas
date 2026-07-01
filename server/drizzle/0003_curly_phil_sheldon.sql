CREATE TABLE `deployment_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'local' NOT NULL,
	`domain` text,
	`admin_email` text,
	`cf_named_token` text,
	`public_url` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`status_message` text,
	`cert_expires_at` integer,
	`last_applied_at` integer
);
--> statement-breakpoint
INSERT INTO deployment_config (id, mode, status) VALUES (1, 'local', 'ready');
