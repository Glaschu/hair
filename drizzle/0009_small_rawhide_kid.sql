CREATE TABLE `days_off` (
	`id` text PRIMARY KEY NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`note` text,
	`updated_at` integer
);
