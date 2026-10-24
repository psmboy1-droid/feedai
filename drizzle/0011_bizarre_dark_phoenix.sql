ALTER TABLE `news_accounts` ADD `display_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_accounts` ADD `email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_accounts` ADD `member_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `news_accounts` ADD `deleted_at` text DEFAULT '' NOT NULL;