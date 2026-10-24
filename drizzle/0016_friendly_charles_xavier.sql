CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`last_success` integer DEFAULT 0 NOT NULL,
	`next_check` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`lock_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_accounts_url_unique` ON `social_accounts` (`url`);--> statement-breakpoint
CREATE TABLE `social_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`url` text NOT NULL,
	`body` text NOT NULL,
	`published_at` integer NOT NULL,
	`media` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_posts_url_unique` ON `social_posts` (`url`);--> statement-breakpoint
CREATE INDEX `social_posts_account_date` ON `social_posts` (`account_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `social_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`payload` text NOT NULL,
	`next_check` integer NOT NULL
);
