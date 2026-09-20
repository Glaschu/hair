CREATE TABLE `booking_links` (
	`token` text PRIMARY KEY NOT NULL,
	`client_ref` text NOT NULL,
	`client_id` text NOT NULL,
	`service_name` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
