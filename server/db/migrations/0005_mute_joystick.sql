CREATE TABLE `rule_format` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`description` text,
	`rules` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rule_format_user` ON `rule_format` (`user_id`);--> statement-breakpoint
ALTER TABLE `deck` ADD `format_id` text REFERENCES rule_format(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_deck_format` ON `deck` (`format_id`);