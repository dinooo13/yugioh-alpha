CREATE TABLE `catalog_card` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`frame_type` text,
	`desc` text NOT NULL,
	`race` text,
	`archetype` text,
	`attribute` text,
	`atk` integer,
	`def` integer,
	`level` integer,
	`linkval` integer,
	`scale` integer,
	`link_markers` text,
	`banlist_info` text,
	`card_prices` text,
	`tcg_date` text,
	`ocg_date` text,
	`ygoprodeck_url` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_card_name` ON `catalog_card` (`name`);--> statement-breakpoint
CREATE INDEX `idx_catalog_card_type` ON `catalog_card` (`type`);--> statement-breakpoint
CREATE INDEX `idx_catalog_card_attribute` ON `catalog_card` (`attribute`);--> statement-breakpoint
CREATE INDEX `idx_catalog_card_tcg_date` ON `catalog_card` (`tcg_date`);--> statement-breakpoint
CREATE TABLE `catalog_card_image` (
	`id` integer PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`image_url_small` text,
	`image_url_cropped` text,
	FOREIGN KEY (`card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_image_card` ON `catalog_card_image` (`card_id`);--> statement-breakpoint
CREATE TABLE `catalog_printing` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`set_id` text NOT NULL,
	`set_code` text NOT NULL,
	`rarity` text,
	`price` text,
	FOREIGN KEY (`card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `catalog_set`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_printing_card` ON `catalog_printing` (`card_id`);--> statement-breakpoint
CREATE INDEX `idx_printing_set` ON `catalog_printing` (`set_id`);--> statement-breakpoint
CREATE TABLE `catalog_set` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_set_name_unique` ON `catalog_set` (`name`);--> statement-breakpoint
CREATE TABLE `catalog_sync` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`card_count` integer,
	`error` text
);
