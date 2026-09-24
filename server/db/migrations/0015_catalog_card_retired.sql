ALTER TABLE `catalog_card` ADD `retired_at` integer;--> statement-breakpoint
ALTER TABLE `catalog_card` ADD `replaced_by_id` integer REFERENCES catalog_card(id) ON UPDATE no action ON DELETE set null;