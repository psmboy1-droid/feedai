CREATE TABLE `dopamine_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`country` text DEFAULT 'KR' NOT NULL,
	`kind` text DEFAULT 'auto' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_checked_at` integer DEFAULT 0 NOT NULL,
	`next_check_at` integer DEFAULT 0 NOT NULL,
	`lock_id` text DEFAULT '' NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dopamine_sources_url_unique` ON `dopamine_sources` (`url`);--> statement-breakpoint
CREATE INDEX `dopamine_sources_due` ON `dopamine_sources` (`enabled`,`next_check_at`);--> statement-breakpoint
CREATE TABLE `dopamine_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`published_at` integer NOT NULL,
	`kind` text NOT NULL,
	`override_kind` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dopamine_videos_source_date` ON `dopamine_videos` (`source_id`,`published_at`);