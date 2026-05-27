ALTER TABLE `appointment_products` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `appointments` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `client_photos` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `clients` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `service_products` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `services` ADD `updated_at` integer;