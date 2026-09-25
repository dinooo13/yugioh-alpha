-- #137: drop the unused deck link (ADR 0021). Hand-written on purpose:
-- drizzle-kit generates a table rebuild for a dropped FK column, but the
-- migrator runs each migration inside one transaction, where
-- `PRAGMA foreign_keys=OFF` has no effect, so the rebuild's DROP TABLE
-- would cascade-delete every assistant message and action. DROP COLUMN
-- works here because the deck FK is a column constraint of deck_id itself
-- (added by 0009); SQLite only refuses while an index uses the column.
DROP INDEX IF EXISTS `idx_assistant_conversation_deck`;--> statement-breakpoint
ALTER TABLE `assistant_conversation` DROP COLUMN `deck_id`;
