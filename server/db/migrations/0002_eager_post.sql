CREATE TABLE `owned_card` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`catalog_card_id` integer NOT NULL,
	`printing_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`condition` text DEFAULT 'near_mint' NOT NULL,
	`edition` text DEFAULT 'unlimited' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printing_id`) REFERENCES `catalog_printing`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_owned_card_user` ON `owned_card` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_owned_card_user_card` ON `owned_card` (`user_id`,`catalog_card_id`);