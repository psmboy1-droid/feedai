ALTER TABLE `shared_categories` ADD `deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_categories` ADD `replacement` text DEFAULT '' NOT NULL;