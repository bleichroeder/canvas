CREATE TABLE `youtube_follows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`yt_id` text NOT NULL,
	`title` text NOT NULL,
	`thumbnail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_follows_user_item` ON `youtube_follows` (`user_id`,`kind`,`yt_id`);