CREATE TABLE `assistant_action` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `assistant_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_action_user_status` ON `assistant_action` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `assistant_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_conversation_user_updated` ON `assistant_conversation` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `assistant_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_call_id` text,
	`tool_name` text,
	`attachments` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_message_conversation_created` ON `assistant_message` (`conversation_id`,`created_at`);