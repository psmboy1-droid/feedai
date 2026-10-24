CREATE TABLE `ai_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`upstream_id` text DEFAULT '' NOT NULL,
	`response` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer DEFAULT 0 NOT NULL,
	`check_after` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_queue_status_created` ON `ai_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_queue_started` ON `ai_queue` (`started_at`);--> statement-breakpoint
CREATE TABLE `feed_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`lock_id` text DEFAULT '' NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL
);
