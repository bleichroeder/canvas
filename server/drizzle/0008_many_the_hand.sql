CREATE TABLE `youtube_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`yt_id` text NOT NULL,
	`title` text NOT NULL,
	`thumbnail` text,
	`channel_id` text,
	`channel_title` text,
	`duration_sec` integer,
	`pos_sec` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_history_user_item` ON `youtube_history` (`user_id`,`yt_id`);