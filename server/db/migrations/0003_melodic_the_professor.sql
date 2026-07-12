CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collection_user` ON `collection` (`user_id`);--> statement-breakpoint
ALTER TABLE `owned_card` ADD `collection_id` text REFERENCES collection(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_owned_card_collection` ON `owned_card` (`collection_id`);