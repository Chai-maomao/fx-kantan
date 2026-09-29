CREATE TABLE `leaderboard_entries` (
	`browser_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`snapshot` text NOT NULL,
	`score` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
