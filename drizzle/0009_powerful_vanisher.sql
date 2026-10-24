CREATE TABLE `analysis_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`claim` text NOT NULL,
	`status` text NOT NULL,
	`job_id` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `news_accounts` ADD `tokens` integer DEFAULT 100 NOT NULL;