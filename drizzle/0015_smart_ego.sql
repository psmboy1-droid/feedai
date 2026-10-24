CREATE TABLE `billing_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text NOT NULL,
	`mode` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`payment_key` text DEFAULT '' NOT NULL,
	`receipt_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `billing_orders_user_created` ON `billing_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`customer_key` text NOT NULL,
	`plan` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`nonce` text NOT NULL,
	`nonce_expires` integer NOT NULL,
	`consent_at` text NOT NULL,
	`next_charge` integer DEFAULT 0 NOT NULL,
	`anchor` integer DEFAULT 0 NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`cancel_at_end` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_customer_key_unique` ON `billing_subscriptions` (`customer_key`);