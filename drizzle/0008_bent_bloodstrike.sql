CREATE TABLE `ai_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`analysis` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
