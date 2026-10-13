CREATE TABLE `trading_accounts` (
	`browser_id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
