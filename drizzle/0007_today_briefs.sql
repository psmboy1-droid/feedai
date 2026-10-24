CREATE TABLE `today_briefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`feed_key` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`job_id` text DEFAULT '' NOT NULL,
	`snapshot` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
