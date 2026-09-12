CREATE TABLE `tournament` (
	`id` text PRIMARY KEY NOT NULL,
	`organizer_user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`format_id` text,
	`pairing_system` text DEFAULT 'swiss' NOT NULL,
	`status` text DEFAULT 'registration' NOT NULL,
	`planned_rounds` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organizer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`format_id`) REFERENCES `rule_format`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_organizer` ON `tournament` (`organizer_user_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_format` ON `tournament` (`format_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_status` ON `tournament` (`status`);--> statement-breakpoint
CREATE TABLE `tournament_match` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`tournament_id` text NOT NULL,
	`table_number` integer NOT NULL,
	`participant_a_id` text NOT NULL,
	`participant_b_id` text,
	`winner_participant_id` text,
	`games_a` integer DEFAULT 0 NOT NULL,
	`games_b` integer DEFAULT 0 NOT NULL,
	`is_draw` integer DEFAULT false NOT NULL,
	`reported_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `tournament_round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_a_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_b_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`winner_participant_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_match_round` ON `tournament_match` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_match_tournament` ON `tournament_match` (`tournament_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_match_participant_a` ON `tournament_match` (`participant_a_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_match_participant_b` ON `tournament_match` (`participant_b_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tournament_match_table` ON `tournament_match` (`round_id`,`table_number`);--> statement-breakpoint
CREATE TABLE `tournament_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`deck_id` text,
	`deck_snapshot` text,
	`deck_legal` integer,
	`deck_issue_count` integer,
	`dropped` integer DEFAULT false NOT NULL,
	`seed` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_participant_tournament` ON `tournament_participant` (`tournament_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_participant_user` ON `tournament_participant` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tournament_participant_unique_user` ON `tournament_participant` (`tournament_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `tournament_round` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_round_tournament` ON `tournament_round` (`tournament_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tournament_round_number` ON `tournament_round` (`tournament_id`,`number`);