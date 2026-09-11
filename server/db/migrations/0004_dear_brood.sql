CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deck_user` ON `deck` (`user_id`);--> statement-breakpoint
CREATE TABLE `deck_card` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`catalog_card_id` integer NOT NULL,
	`section` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deck_card_unique` ON `deck_card` (`deck_id`,`catalog_card_id`,`section`);--> statement-breakpoint
CREATE INDEX `idx_deck_card_deck` ON `deck_card` (`deck_id`);