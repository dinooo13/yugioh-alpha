import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { catalogCard, catalogPrinting } from '../db/schema'

export type CatalogSort = 'name' | '-name' | 'newest'

export interface CardListQuery {
  q: string
  inText: boolean
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  setId?: string
  sort: CatalogSort
  page: number
  pageSize: number
}

type RawQueryValue = string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>
export type RawCardListQuery = Record<string, RawQueryValue>

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60
const SORTS = new Set<CatalogSort>(['name', '-name', 'newest'])

function getValues(value: RawQueryValue): string[] {
  const values = Array.isArray(value) ? value : [value]

  return values
    .flatMap(item => String(item ?? '').split(','))
    .map(item => item.trim())
    .filter(Boolean)
}

function getFirst(value: RawQueryValue): string | undefined {
  return getValues(value)[0]
}

function parsePositiveInt(value: RawQueryValue, fallback: number): number {
  const parsed = Number.parseInt(getFirst(value) ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function escapeLikeTerm(term: string): string {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function escapedLike(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} like ${pattern} escape '\\'`
}

export function parseCardListQuery(rawQuery: RawCardListQuery): CardListQuery {
  const page = parsePositiveInt(rawQuery.page, 1)
  const requestedPageSize = parsePositiveInt(rawQuery.pageSize, DEFAULT_PAGE_SIZE)
  const sort = getFirst(rawQuery.sort)

  return {
    q: (getFirst(rawQuery.q) ?? '').trim(),
    inText: getFirst(rawQuery.inText) === '1',
    types: getValues(rawQuery.type),
    attributes: getValues(rawQuery.attribute),
    races: getValues(rawQuery.race),
    levels: getValues(rawQuery.level)
      .map(value => Number.parseInt(value, 10))
      .filter(Number.isFinite),
    setId: getFirst(rawQuery.setId),
    sort: sort && SORTS.has(sort as CatalogSort) ? sort as CatalogSort : 'name',
    page,
    pageSize: Math.min(requestedPageSize, MAX_PAGE_SIZE),
  }
}

export function buildCardListWhere(filters: CardListQuery): SQL | undefined {
  const conditions: SQL[] = []

  if (filters.q) {
    const pattern = `%${escapeLikeTerm(filters.q)}%`
    const nameCondition = escapedLike(catalogCard.name, pattern)
    conditions.push(
      filters.inText
        ? or(nameCondition, escapedLike(catalogCard.desc, pattern))!
        : nameCondition,
    )
  }

  if (filters.types.length > 0) {
    conditions.push(inArray(catalogCard.type, filters.types))
  }

  if (filters.attributes.length > 0) {
    conditions.push(inArray(catalogCard.attribute, filters.attributes))
  }

  if (filters.races.length > 0) {
    conditions.push(inArray(catalogCard.race, filters.races))
  }

  if (filters.levels.length > 0) {
    conditions.push(inArray(catalogCard.level, filters.levels))
  }

  if (filters.setId) {
    conditions.push(sql`exists (
      select 1 from ${catalogPrinting}
      where ${eq(catalogPrinting.cardId, catalogCard.id)}
        and ${eq(catalogPrinting.setId, filters.setId)}
    )`)
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}
