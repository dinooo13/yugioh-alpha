import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, ownedCard } from '../db/schema'
import { cardNameMatches, cardTextMatches } from './card-name-search'
import { cardNameDeSql } from './card-translation-sql'
import { UNASSIGNED_COLLECTION_ID } from '../../shared/inventory'

export { UNASSIGNED_COLLECTION_ID }

type Db = ReturnType<typeof useDb>

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
 * clamped filter set. Never throws — unknown params (including the former
 * `setId`/`language`/`condition`/`edition` filters, ADR 0017) are ignored and
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
    collectionId: toTrimmedString(rawQuery.collectionId),
    sort: toSort(rawQuery.sort),
    page: toPositiveInt(rawQuery.page, DEFAULT_PAGE),
    pageSize,
  }
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
    // Bilingual: English and German names (and texts with `inText`), ADR 0015.
    const nameMatches = cardNameMatches(filters.q)
    clauses.push(
      filters.inText
        ? (or(nameMatches, cardTextMatches(filters.q)) as SQL)
        : nameMatches,
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

export interface InventorySearchFacets {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== ''
}

function uniqueSortedStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(isNonEmptyString))).sort((a, b) => a.localeCompare(b))
}

/**
 * The filter options of the inventory search: the distinct catalog values
 * over every card the user owns. Only catalog properties — the inventory has
 * no set, language, condition or edition filters (ADR 0017).
 */
export function loadInventorySearchFacets(db: Db, userId: string): InventorySearchFacets {
  const rows = db
    .selectDistinct({
      type: catalogCard.type,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .where(eq(ownedCard.userId, userId))
    .all()

  const levels = Array.from(
    new Set(rows.map(row => row.level).filter((level): level is number => level !== null)),
  ).sort((a, b) => a - b)

  return {
    types: uniqueSortedStrings(rows.map(row => row.type)),
    attributes: uniqueSortedStrings(rows.map(row => row.attribute)),
    // Skill Cards store the story character's (truncated) name in `race`, not
    // a real monster race — excluded from the "Monsterart" facet (UX review
    // #17), matching `getCatalogFacets` in server/utils/catalog-search.ts.
    races: uniqueSortedStrings(rows.filter(row => row.type !== 'Skill Card').map(row => row.race)),
    levels,
  }
}

export interface InventoryCardDisplay {
  catalogCardId: number
  name: string
  /** Official German name (ADR 0015); null when there is none. */
  nameDe: string | null
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  imageLarge: string | null
  /** YGOPRODeck no longer lists the card (ADR 0019); it stays in the inventory. */
  retired: boolean
}

/**
 * Loads the catalog display fields (name, stats, primary artwork) for a page
 * of inventory search results. The primary artwork is the card's image with
 * the lowest `catalog_card_image.id` — the same rule the catalog search uses —
 * so the small and large URLs always come from the same art variant.
 */
export function loadInventoryCardDisplay(db: Db, catalogCardIds: number[]): Map<number, InventoryCardDisplay> {
  const display = new Map<number, InventoryCardDisplay>()
  if (catalogCardIds.length === 0) {
    return display
  }

  const cards = db
    .select({
      catalogCardId: catalogCard.id,
      name: catalogCard.name,
      nameDe: cardNameDeSql(),
      type: catalogCard.type,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      retiredAt: catalogCard.retiredAt,
    })
    .from(catalogCard)
    .where(inArray(catalogCard.id, catalogCardIds))
    .all()

  const imageRows = db
    .select({
      cardId: catalogCardImage.cardId,
      imageUrl: catalogCardImage.imageUrl,
      imageUrlSmall: catalogCardImage.imageUrlSmall,
    })
    .from(catalogCardImage)
    .where(inArray(catalogCardImage.cardId, catalogCardIds))
    .orderBy(asc(catalogCardImage.cardId), asc(catalogCardImage.id))
    .all()

  const primaryImages = new Map<number, { imageSmall: string, imageLarge: string }>()
  for (const image of imageRows) {
    if (!primaryImages.has(image.cardId)) {
      primaryImages.set(image.cardId, {
        imageSmall: image.imageUrlSmall ?? image.imageUrl,
        imageLarge: image.imageUrl,
      })
    }
  }

  for (const { retiredAt, ...card } of cards) {
    const image = primaryImages.get(card.catalogCardId)
    display.set(card.catalogCardId, {
      ...card,
      imageSmall: image?.imageSmall ?? null,
      imageLarge: image?.imageLarge ?? null,
      retired: retiredAt !== null,
    })
  }

  return display
}
