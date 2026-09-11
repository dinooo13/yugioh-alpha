import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { catalogCard, catalogPrinting, ownedCard } from '../db/schema'
import { CONDITIONS, EDITIONS, LANGUAGES } from './inventory'
import type { InventoryCondition, InventoryEdition, InventoryLanguage } from './inventory'

// Special `collectionId` value selecting owned cards that are not assigned
// to any collection (i.e. `owned_card.collection_id IS NULL`).
export const UNASSIGNED_COLLECTION_ID = '__none__'

export type InventorySearchSort = 'name' | '-name' | 'quantity' | 'newest'

const SORT_VALUES: readonly InventorySearchSort[] = ['name', '-name', 'quantity', 'newest']
const DEFAULT_SORT: InventorySearchSort = 'name'
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60

export interface InventorySearchFilters {
  q?: string
  inText: boolean
  type: string[]
  attribute: string[]
  race: string[]
  level: number[]
  setId?: string
  language: InventoryLanguage[]
  condition: InventoryCondition[]
  edition: InventoryEdition[]
  // A collection id owned by the caller, or `UNASSIGNED_COLLECTION_ID`.
  collectionId?: string
  sort: InventorySearchSort
  page: number
  pageSize: number
}

function toValueList(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) {
    return []
  }
  return Array.isArray(raw) ? raw : [raw]
}

// Accepts repeated query params (`type=A&type=B`) and/or CSV (`type=A,B`).
function toStringArray(raw: unknown): string[] {
  const out: string[] = []
  for (const value of toValueList(raw)) {
    if (typeof value !== 'string') {
      continue
    }
    for (const part of value.split(',')) {
      const trimmed = part.trim()
      if (trimmed !== '') {
        out.push(trimmed)
      }
    }
  }
  return out
}

function toIntArray(raw: unknown): number[] {
  return toStringArray(raw)
    .map(value => Number(value))
    .filter(value => Number.isInteger(value))
}

function toEnumArray<T extends readonly string[]>(raw: unknown, allowed: T): Array<T[number]> {
  const allowedSet = new Set<string>(allowed)
  return toStringArray(raw).filter((value): value is T[number] => allowedSet.has(value))
}

function toTrimmedString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function toBooleanFlag(raw: unknown): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '1' || value === 1 || value === true
}

function toSort(raw: unknown): InventorySearchSort {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && (SORT_VALUES as readonly string[]).includes(value)
    ? (value as InventorySearchSort)
    : DEFAULT_SORT
}

function toPositiveInt(raw: unknown, fallback: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numberValue) && numberValue >= 1 ? numberValue : fallback
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Coerces raw query params (as returned by h3's `getQuery`) into a typed,
 * clamped filter set. Never throws — unknown enum values are dropped and
 * invalid paging falls back to defaults, matching the project's hand-rolled
 * (no Zod) validation style.
 */
export function parseInventorySearchQuery(rawQuery: Record<string, unknown>): InventorySearchFilters {
  const pageSize = clampInt(toPositiveInt(rawQuery.pageSize, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE)

  return {
    q: toTrimmedString(rawQuery.q),
    inText: toBooleanFlag(rawQuery.inText),
    type: toStringArray(rawQuery.type),
    attribute: toStringArray(rawQuery.attribute),
    race: toStringArray(rawQuery.race),
    level: toIntArray(rawQuery.level),
    setId: toTrimmedString(rawQuery.setId),
    language: toEnumArray(rawQuery.language, LANGUAGES),
    condition: toEnumArray(rawQuery.condition, CONDITIONS),
    edition: toEnumArray(rawQuery.edition, EDITIONS),
    collectionId: toTrimmedString(rawQuery.collectionId),
    sort: toSort(rawQuery.sort),
    page: toPositiveInt(rawQuery.page, DEFAULT_PAGE),
    pageSize,
  }
}

// Escapes SQLite LIKE wildcards so a user's search term is matched literally.
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`)
}

function likeCondition(column: AnySQLiteColumn, term: string): SQL {
  return sql`${column} LIKE ${term} ESCAPE '\\'`
}

/**
 * Builds the Drizzle WHERE condition for the aggregated inventory search,
 * scoped to `userId`. Pure and HTTP-free so it can be unit tested directly.
 *
 * `collectionId` (when not `UNASSIGNED_COLLECTION_ID`) is intentionally an
 * `EXISTS` check correlated only on `catalog_card_id` (not on the row being
 * evaluated) — it gates *which* cards qualify without restricting which of
 * that card's owned rows are summed/broken down, so a card's full
 * cross-collection picture is preserved even when filtering by collection.
 */
export function buildInventorySearchWhere(userId: string, filters: InventorySearchFilters): SQL {
  const clauses: SQL[] = [eq(ownedCard.userId, userId)]

  if (filters.q) {
    const likeTerm = `%${escapeLikeTerm(filters.q)}%`
    const nameLike = likeCondition(catalogCard.name, likeTerm)
    clauses.push(
      filters.inText
        ? (or(nameLike, likeCondition(catalogCard.desc, likeTerm)) as SQL)
        : nameLike,
    )
  }

  if (filters.type.length > 0) {
    clauses.push(inArray(catalogCard.type, filters.type) as SQL)
  }
  if (filters.attribute.length > 0) {
    clauses.push(inArray(catalogCard.attribute, filters.attribute) as SQL)
  }
  if (filters.race.length > 0) {
    clauses.push(inArray(catalogCard.race, filters.race) as SQL)
  }
  if (filters.level.length > 0) {
    clauses.push(inArray(catalogCard.level, filters.level) as SQL)
  }

  if (filters.language.length > 0) {
    clauses.push(inArray(ownedCard.language, filters.language) as SQL)
  }
  if (filters.condition.length > 0) {
    clauses.push(inArray(ownedCard.condition, filters.condition) as SQL)
  }
  if (filters.edition.length > 0) {
    clauses.push(inArray(ownedCard.edition, filters.edition) as SQL)
  }

  if (filters.setId) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM ${catalogPrinting}
      WHERE ${catalogPrinting.cardId} = ${ownedCard.catalogCardId}
        AND ${catalogPrinting.setId} = ${filters.setId}
    )`)
  }

  if (filters.collectionId) {
    clauses.push(
      filters.collectionId === UNASSIGNED_COLLECTION_ID
        ? (isNull(ownedCard.collectionId) as SQL)
        : sql`EXISTS (
            SELECT 1 FROM ${ownedCard} AS oc_collection_filter
            WHERE oc_collection_filter.catalog_card_id = ${ownedCard.catalogCardId}
              AND oc_collection_filter.user_id = ${userId}
              AND oc_collection_filter.collection_id = ${filters.collectionId}
          )`,
    )
  }

  return and(...clauses) as SQL
}
