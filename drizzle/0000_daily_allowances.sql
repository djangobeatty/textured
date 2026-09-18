CREATE TABLE `browser_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_browser_sessions_expiry` ON `browser_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`subject` text NOT NULL,
	`day` text NOT NULL,
	`used` integer NOT NULL,
	PRIMARY KEY(`subject`, `day`),
	CONSTRAINT "daily_usage_nonnegative" CHECK("daily_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_daily_usage_day` ON `daily_usage` (`day`);