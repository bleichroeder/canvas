CREATE TABLE `error_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`user_id` integer,
	`canvas_version` text,
	`user_agent` text,
	`error_message` text,
	`error_kind` text,
	`source_type` text,
	`report_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_error_reports_created` ON `error_reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_error_reports_kind_created` ON `error_reports` (`error_kind`,`created_at`);