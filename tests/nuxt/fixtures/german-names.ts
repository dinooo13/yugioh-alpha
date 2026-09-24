import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../../server/db/schema'
import { foldCardName } from '../../../shared/card-name-fold'

/**
 * Adds German names (ADR 0015) for cards a test seeded itself, the way the
 * translation sync stores them (`name_search` folded).
 */
export function seedGermanNames(db: BetterSQLite3Database<typeof schema>, names: Record<number, string>) {
  db.insert(schema.catalogCardTranslation).values(Object.entries(names).map(([cardId, name]) => ({
    cardId: Number(cardId),
    locale: 'de' as const,
    name,
    nameSearch: foldCardName(name),
    source: 'ygoresources-git' as const,
    syncedAt: new Date('2025-01-01T00:00:00.000Z'),
  }))).run()
}
