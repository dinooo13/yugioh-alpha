CREATE TABLE `share_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`granted_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_share_grant_unique` ON `share_grant` (`resource_type`,`resource_id`,`granted_user_id`);--> statement-breakpoint
CREATE INDEX `idx_share_grant_resource` ON `share_grant` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_share_grant_granted_user` ON `share_grant` (`granted_user_id`);--> statement-breakpoint
CREATE INDEX `idx_share_grant_owner` ON `share_grant` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`bio` text,
	`inventory_visibility` text DEFAULT 'private' NOT NULL,
	`inventory_share_token` text,
	`wishlist_visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_handle_unique` ON `user_profile` (`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_inventory_share_token_unique` ON `user_profile` (`inventory_share_token`);--> statement-breakpoint
CREATE INDEX `idx_user_profile_display_name` ON `user_profile` (`display_name`);--> statement-breakpoint
CREATE TABLE `wishlist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`catalog_card_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wishlist_item_unique` ON `wishlist_item` (`user_id`,`catalog_card_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_item_user` ON `wishlist_item` (`user_id`);--> statement-breakpoint
ALTER TABLE `collection` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `collection` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_share_token_unique` ON `collection` (`share_token`);--> statement-breakpoint
CREATE INDEX `idx_collection_user_visibility` ON `collection` (`user_id`,`visibility`);--> statement-breakpoint
ALTER TABLE `deck` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `deck` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `deck_share_token_unique` ON `deck` (`share_token`);--> statement-breakpoint
CREATE INDEX `idx_deck_user_visibility` ON `deck` (`user_id`,`visibility`);