CREATE TABLE `catalog_card_translation` (
	`card_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`name_search` text NOT NULL,
	`desc` text,
	`source` text NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `locale`),
	FOREIGN KEY (`card_id`) REFERENCES `catalog_card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_card_translation_search` ON `catalog_card_translation` (`locale`,`name_search`,`card_id`);--> statement-breakpoint
ALTER TABLE `catalog_card` ADD `konami_id` integer;--> statement-breakpoint
ALTER TABLE `catalog_card` ADD `name_search` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_catalog_card_konami_id` ON `catalog_card` (`konami_id`);--> statement-breakpoint
ALTER TABLE `catalog_sync` ADD `source` text DEFAULT 'ygoprodeck' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync` ADD `revision` text;