CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`name` text NOT NULL,
	`key_hash` text NOT NULL UNIQUE,
	`start` text NOT NULL,
	`destination_id` text NOT NULL,
	`domain_id` text,
	`format` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_api_keys_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_keys_destination_id_destinations_id_fk` FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_keys_domain_id_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `api_keys_user` ON `api_keys` (`user_id`);