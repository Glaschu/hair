CREATE TABLE `appointment_products` (
	`appointment_id` text NOT NULL,
	`product_id` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`service` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `client_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`date` text NOT NULL,
	`url` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tone` text DEFAULT '#C49A7A' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`since` text NOT NULL,
	`visits` integer DEFAULT 0 NOT NULL,
	`spend` real DEFAULT 0 NOT NULL,
	`hair_type` text DEFAULT 'Wavy' NOT NULL,
	`hair_length` text DEFAULT 'Mid-length' NOT NULL,
	`hair_natural` text DEFAULT 'Dark brown' NOT NULL,
	`formula` text DEFAULT '' NOT NULL,
	`allergies` text DEFAULT 'None on file' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`vip` integer DEFAULT false NOT NULL,
	`photo` text
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`size` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'mL' NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`reorder` real DEFAULT 0 NOT NULL,
	`per_use` real DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`barcode` text
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`day` integer PRIMARY KEY NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`start` text DEFAULT '09:00' NOT NULL,
	`end` text DEFAULT '18:00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_products` (
	`service_id` text NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`duration` integer DEFAULT 60 NOT NULL,
	`price` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
