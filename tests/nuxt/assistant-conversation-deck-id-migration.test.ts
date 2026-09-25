// Migration 0017 (#137): drops the unused `assistant_conversation.deck_id`
// (ADR 0021) with DROP INDEX + ALTER TABLE … DROP COLUMN, never with the
// table rebuild drizzle-kit generates for a dropped FK column. The migrator
// runs every migration inside one transaction, where `PRAGMA foreign_keys=OFF`
// does nothing, so a rebuild's DROP TABLE would cascade-delete every message
// and action. This runs 0000–0016 on an in-memory DB, seeds a conversation
// with a deck link, and applies 0017 the way the migrator does.

import { readdirSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'

const MIGRATIONS = './server/db/migrations'
const DROP_DECK_ID_IDX = 17

interface JournalEntry { idx: number, tag: string }

const journal = (JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as { entries: JournalEntry[] }).entries

function migrationSql(entry: JournalEntry): string {
  return readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, 'utf8')
}

/** The SQL without its `--` comment lines (0017 explains the rebuild it avoids). */
function withoutComments(sql: string): string {
  return sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
}

function statements(sql: string): string[] {
  return sql.split('--> statement-breakpoint').map(statement => statement.trim()).filter(statement => statement !== '')
}

const dropDeckId = journal.find(entry => entry.idx === DROP_DECK_ID_IDX)!

/** An in-memory DB at migration 0016 (the state production is in), foreign keys on as in the app. */
function databaseBeforeDrop() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const entry of journal.filter(entry => entry.idx < DROP_DECK_ID_IDX)) {
    for (const statement of statements(migrationSql(entry))) {
      sqlite.prepare(statement).run()
    }
  }
  return sqlite
}

function seed(sqlite: Database.Database) {
  const now = Date.now()
  sqlite.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run('user-a', 'User A', 'a@example.com', now, now)
  sqlite.prepare('INSERT INTO deck (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('deck-1', 'user-a', 'Magier-Deck', now, now)
  const conversation = sqlite.prepare('INSERT INTO assistant_conversation (id, user_id, title, created_at, updated_at, deck_id) VALUES (?, ?, ?, ?, ?, ?)')
  conversation.run('conv-linked', 'user-a', 'Deck: Magier-Deck', now, now, 'deck-1')
  conversation.run('conv-plain', 'user-a', 'Neue Unterhaltung', now, now, null)
  const message = sqlite.prepare('INSERT INTO assistant_message (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
  message.run('m1', 'conv-linked', 'user', 'Hallo', now)
  message.run('m2', 'conv-linked', 'assistant', 'Hi', now + 1)
  message.run('m3', 'conv-plain', 'user', 'Moin', now + 2)
  message.run('m4', 'conv-plain', 'assistant', 'Moin!', now + 3)
  sqlite.prepare('INSERT INTO assistant_action (id, conversation_id, message_id, user_id, kind, payload, summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('act-1', 'conv-linked', 'm2', 'user-a', 'add_to_inventory', '{"items":[]}', 's', 'applied', now)
  sqlite.prepare('INSERT INTO assistant_action (id, conversation_id, message_id, user_id, kind, payload, summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('act-2', 'conv-plain', 'm4', 'user-a', 'add_to_inventory', '{"items":[]}', 's', 'pending', now)
}

function counts(sqlite: Database.Database) {
  const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
  return { conversations: count('assistant_conversation'), messages: count('assistant_message'), actions: count('assistant_action') }
}

/** Applies 0017 like drizzle's migrator: every statement of the file inside one transaction. */
function applyDropDeckId(sqlite: Database.Database) {
  sqlite.exec('BEGIN')
  try {
    for (const statement of statements(migrationSql(dropDeckId))) {
      sqlite.prepare(statement).run()
    }
    sqlite.exec('COMMIT')
  }
  catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

describe('migration 0017: drop assistant_conversation.deck_id (#137)', () => {
  it('is the hand-written DROP INDEX + DROP COLUMN, not a table rebuild', () => {
    expect(dropDeckId.tag).toBe('0017_assistant_conversation_drop_deck_id')
    const sql = withoutComments(migrationSql(dropDeckId))
    expect(sql).not.toMatch(/DROP TABLE/i)
    expect(sql).not.toContain('__new_')
    expect(statements(sql)).toEqual([
      'DROP INDEX IF EXISTS `idx_assistant_conversation_deck`;',
      'ALTER TABLE `assistant_conversation` DROP COLUMN `deck_id`;',
    ])
  })

  it('keeps every conversation, message and action, and drops the column and its index', () => {
    const sqlite = databaseBeforeDrop()
    seed(sqlite)
    const before = counts(sqlite)

    applyDropDeckId(sqlite)

    expect(counts(sqlite)).toEqual(before)
    expect(before).toEqual({ conversations: 2, messages: 4, actions: 2 })
    expect(sqlite.prepare('SELECT id, title FROM assistant_conversation ORDER BY id').all()).toEqual([
      { id: 'conv-linked', title: 'Deck: Magier-Deck' },
      { id: 'conv-plain', title: 'Neue Unterhaltung' },
    ])
    const columns = (sqlite.prepare('PRAGMA table_info(assistant_conversation)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).toEqual(['id', 'user_id', 'title', 'created_at', 'updated_at'])
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'index\' AND name = \'idx_assistant_conversation_deck\'').all()).toEqual([])
    expect(sqlite.prepare('SELECT * FROM pragma_foreign_key_list(\'assistant_conversation\')').all())
      .toEqual([expect.objectContaining({ table: 'user', from: 'user_id' })])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('leaves conversations alone when a deck is deleted, and still cascades a deleted conversation', () => {
    const sqlite = databaseBeforeDrop()
    seed(sqlite)
    applyDropDeckId(sqlite)

    sqlite.prepare('DELETE FROM deck WHERE id = ?').run('deck-1')
    expect(counts(sqlite)).toEqual({ conversations: 2, messages: 4, actions: 2 })

    sqlite.prepare('DELETE FROM assistant_conversation WHERE id = ?').run('conv-linked')
    expect(counts(sqlite)).toEqual({ conversations: 1, messages: 2, actions: 1 })
    expect(sqlite.prepare('SELECT conversation_id FROM assistant_message').all()).toEqual([
      { conversation_id: 'conv-plain' },
      { conversation_id: 'conv-plain' },
    ])
  })

  it('runs with every other migration through drizzle\'s migrator on a fresh database', () => {
    const sqlite = new Database(':memory:')
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS })
    const columns = (sqlite.prepare('PRAGMA table_info(assistant_conversation)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).not.toContain('deck_id')
  })
})

describe('migrations after 0016', () => {
  it('never rebuild a table: under the in-transaction migrator its DROP TABLE would cascade-delete child rows', () => {
    const files = readdirSync(MIGRATIONS).filter(file => /^\d{4}_.*\.sql$/.test(file) && Number(file.slice(0, 4)) >= DROP_DECK_ID_IDX)
    expect(files.length).toBeGreaterThan(0)
    const rebuilds = files.filter((file) => {
      const sql = withoutComments(readFileSync(`${MIGRATIONS}/${file}`, 'utf8'))
      return /DROP TABLE/i.test(sql) && sql.includes('__new_')
    })
    expect(rebuilds).toEqual([])
  })
})
