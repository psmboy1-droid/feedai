CREATE TABLE `shared_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`country` text NOT NULL,
	`category` text NOT NULL,
	`language` text NOT NULL,
	`kind` text NOT NULL,
	`verified_at` text NOT NULL,
	`item_count` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_feeds_url_unique` ON `shared_feeds` (`url`);