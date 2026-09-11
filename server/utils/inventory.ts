import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import {
  catalogCard,
  catalogCardImage,
  catalogPrinting,
  catalogSet,
  ownedCard,
} from '../db/schema'
import { assertCollectionOwnedByUser } from './collections'

type Db = ReturnType<typeof useDb>

export const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja', 'ko'] as const
export const CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'] as const
export const EDITIONS = ['first', 'unlimited', 'limited'] as const
// Upper bound for a single owned-card stack. Guards against a typo (or a
// misparsed entry line) turning into a five-digit quantity.
export const MAX_QUANTITY = 999

export type InventoryLanguage = typeof LANGUAGES[number]
export type InventoryCondition = typeof CONDITIONS[number]
export type InventoryEdition = typeof EDITIONS[number]

export interface InventoryInput {
  catalogCardId: number
  printingId: string | null
  collectionId: string | null
  quantity: number
  language: InventoryLanguage
  condition: InventoryCondition
  edition: InventoryEdition
  note: string | null
}

export interface InventoryListOptions {
  q?: string
  page?: number
  pageSize?: number
  collectionId?: string
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePositiveInteger(value: unknown, field: string, fallback?: number, max?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback
    }
    badRequest(`${field} is required`)
  }

  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    badRequest(`${field} must be a positive integer`)
  }
  if (max !== undefined && numberValue > max) {
    badRequest(`${field} must be at most ${max}`)
  }

  return numberValue
}

function normalizeOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    badRequest(`${field} must be a string`)
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = value === undefined || value === null || value === '' ? fallback : value
  if (typeof normalized !== 'string' || !allowed.includes(normalized)) {
    badRequest(`${field} is not supported`)
  }

  return normalized
}

export function validateInventoryInput(body: unknown): InventoryInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  return {
    catalogCardId: normalizePositiveInteger(body.catalog_card_id ?? body.catalogCardId, 'catalog_card_id'),
    printingId: normalizeOptionalString(body.printing_id ?? body.printingId, 'printing_id'),
    collectionId: normalizeOptionalString(body.collection_id ?? body.collectionId, 'collection_id'),
    quantity: normalizePositiveInteger(body.quantity, 'quantity', 1, MAX_QUANTITY),
    language: normalizeEnum(body.language, 'language', LANGUAGES, 'en'),
    condition: normalizeEnum(body.condition, 'condition', CONDITIONS, 'near_mint'),
    edition: normalizeEnum(body.edition, 'edition', EDITIONS, 'unlimited'),
    note: normalizeOptionalString(body.note, 'note'),
  }
}

export function validateInventoryUpdateInput(body: unknown): Partial<InventoryInput> {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: Partial<InventoryInput> = {}
  if (body.catalog_card_id !== undefined || body.catalogCardId !== undefined) {
    input.catalogCardId = normalizePositiveInteger(body.catalog_card_id ?? body.catalogCardId, 'catalog_card_id')
  }
  if (body.printing_id !== undefined || body.printingId !== undefined) {
    input.printingId = normalizeOptionalString(body.printing_id ?? body.printingId, 'printing_id')
  }
  if (body.collection_id !== undefined || body.collectionId !== undefined) {
    input.collectionId = normalizeOptionalString(body.collection_id ?? body.collectionId, 'collection_id')
  }
  if (body.quantity !== undefined) {
    input.quantity = normalizePositiveInteger(body.quantity, 'quantity', undefined, MAX_QUANTITY)
  }
  if (body.language !== undefined) {
    input.language = normalizeEnum(body.language, 'language', LANGUAGES, 'en')
  }
  if (body.condition !== undefined) {
    input.condition = normalizeEnum(body.condition, 'condition', CONDITIONS, 'near_mint')
  }
  if (body.edition !== undefined) {
    input.edition = normalizeEnum(body.edition, 'edition', EDITIONS, 'unlimited')
  }
  if (body.note !== undefined) {
    input.note = normalizeOptionalString(body.note, 'note')
  }

  return input
}

export function ensureCatalogCardExists(db: Db, catalogCardId: number, printingId?: string | null) {
  const card = db.select({ id: catalogCard.id }).from(catalogCard).where(eq(catalogCard.id, catalogCardId)).get()
  if (!card) {
    badRequest('catalog_card_id does not exist')
  }

  if (printingId) {
    const printing = db
      .select({ id: catalogPrinting.id })
      .from(catalogPrinting)
      .where(and(eq(catalogPrinting.id, printingId), eq(catalogPrinting.cardId, catalogCardId)))
      .get()
    if (!printing) {
      badRequest('printing_id does not exist for catalog_card_id')
    }
  }
}

function sameTupleWhere(userId: string, input: InventoryInput, exceptId?: string) {
  const clauses = [
    eq(ownedCard.userId, userId),
    eq(ownedCard.catalogCardId, input.catalogCardId),
    input.printingId ? eq(ownedCard.printingId, input.printingId) : isNull(ownedCard.printingId),
    input.collectionId ? eq(ownedCard.collectionId, input.collectionId) : isNull(ownedCard.collectionId),
    eq(ownedCard.language, input.language),
    eq(ownedCard.condition, input.condition),
    eq(ownedCard.edition, input.edition),
  ]

  if (exceptId) {
    clauses.push(ne(ownedCard.id, exceptId))
  }

  return and(...clauses)
}

export type OwnedCardRow = typeof ownedCard.$inferSelect

/**
 * Writes one owned-card row, merging into an existing row with the same
 * ownership tuple instead of creating a duplicate. Assumes the input was
 * already validated (catalog/printing existence, collection ownership) —
 * `addOwnedCard` does that per request, the bulk endpoint does it for every
 * item up front so the whole batch can run inside one transaction.
 */
function upsertOwnedCardRow(
  db: Db,
  userId: string,
  input: InventoryInput,
): { row: OwnedCardRow, merged: boolean } {
  const now = new Date()
  const existing = db.select().from(ownedCard).where(sameTupleWhere(userId, input)).get()

  if (existing) {
    const [updated] = db
      .update(ownedCard)
      .set({
        quantity: existing.quantity + input.quantity,
        note: input.note ?? existing.note,
        updatedAt: now,
      })
      .where(eq(ownedCard.id, existing.id))
      .returning()
      .all()
    return { row: updated!, merged: true }
  }

  const [created] = db
    .insert(ownedCard)
    .values({
      id: randomUUID(),
      userId,
      catalogCardId: input.catalogCardId,
      printingId: input.printingId,
      collectionId: input.collectionId,
      quantity: input.quantity,
      language: input.language,
      condition: input.condition,
      edition: input.edition,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all()

  return { row: created!, merged: false }
}

export async function addOwnedCard(db: Db, userId: string, input: InventoryInput) {
  ensureCatalogCardExists(db, input.catalogCardId, input.printingId)
  if (input.collectionId) {
    assertCollectionOwnedByUser(db, userId, input.collectionId)
  }

  return upsertOwnedCardRow(db, userId, input).row
}

export const INVENTORY_BULK_MAX_ITEMS = 200

export interface InventoryBulkItemError {
  index: number
  message: string
}

export interface InventoryBulkResult {
  created: number
  merged: number
  items: OwnedCardRow[]
}

/**
 * Per-item validation failures are client errors and get reported with their
 * index. Anything else (a bug, a database failure) is not the caller's fault
 * and must not be flattened into a 400 with a leaked internal message.
 */
function clientErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const candidate = error as { statusCode?: unknown, statusMessage?: unknown }
  if (typeof candidate.statusCode !== 'number' || candidate.statusCode < 400 || candidate.statusCode >= 500) {
    return undefined
  }

  return typeof candidate.statusMessage === 'string' && candidate.statusMessage !== ''
    ? candidate.statusMessage
    : 'Invalid item'
}

/**
 * Validates a whole bulk payload before anything is written: shape, per-item
 * fields (same validators as the single-card endpoint), catalog/printing
 * existence, and collection ownership. Fails with a single 400 carrying every
 * offending item's index, so the review UI can mark the exact rows.
 */
export function validateInventoryBulkInput(db: Db, userId: string, body: unknown): InventoryInput[] {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawItems = body.items
  if (!Array.isArray(rawItems)) {
    badRequest('items must be an array')
  }
  if (rawItems.length === 0) {
    badRequest('items must contain at least one entry')
  }
  if (rawItems.length > INVENTORY_BULK_MAX_ITEMS) {
    badRequest(`items must contain at most ${INVENTORY_BULK_MAX_ITEMS} entries`)
  }

  const inputs: InventoryInput[] = []
  const errors: InventoryBulkItemError[] = []

  rawItems.forEach((rawItem, index) => {
    try {
      const input = validateInventoryInput(rawItem)
      ensureCatalogCardExists(db, input.catalogCardId, input.printingId)
      if (input.collectionId) {
        assertCollectionOwnedByUser(db, userId, input.collectionId)
      }
      inputs.push(input)
    }
    catch (error) {
      const message = clientErrorMessage(error)
      if (message === undefined) {
        throw error
      }
      errors.push({ index, message })
    }
  })

  if (errors.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Some items are invalid',
      data: { errors },
    })
  }

  return inputs
}

/**
 * Writes every already-validated item in a single transaction (all or
 * nothing), reusing the same dedup semantics as `addOwnedCard`.
 */
export async function addOwnedCardsBulk(
  db: Db,
  userId: string,
  inputs: InventoryInput[],
): Promise<InventoryBulkResult> {
  return db.transaction((tx) => {
    const items: OwnedCardRow[] = []
    let created = 0
    let merged = 0

    for (const input of inputs) {
      // better-sqlite3 transactions are synchronous; `tx` exposes the same
      // query builder surface as the root client here.
      const result = upsertOwnedCardRow(tx as unknown as Db, userId, input)
      items.push(result.row)
      if (result.merged) {
        merged += 1
      }
      else {
        created += 1
      }
    }

    return { created, merged, items }
  })
}

export async function updateOwnedCard(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<InventoryInput>,
) {
  if (patch.quantity !== undefined && patch.quantity < 1) {
    badRequest('quantity must be a positive integer')
  }

  const current = db
    .select()
    .from(ownedCard)
    .where(and(eq(ownedCard.id, id), eq(ownedCard.userId, userId)))
    .get()

  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Owned card not found' })
  }

  const input: InventoryInput = {
    catalogCardId: patch.catalogCardId ?? current.catalogCardId,
    printingId: patch.printingId !== undefined ? patch.printingId : current.printingId,
    collectionId: patch.collectionId !== undefined ? patch.collectionId : current.collectionId,
    quantity: patch.quantity ?? current.quantity,
    language: patch.language ?? (current.language as InventoryLanguage),
    condition: patch.condition ?? (current.condition as InventoryCondition),
    edition: patch.edition ?? (current.edition as InventoryEdition),
    note: patch.note !== undefined ? patch.note : current.note,
  }

  ensureCatalogCardExists(db, input.catalogCardId, input.printingId)
  if (input.collectionId) {
    assertCollectionOwnedByUser(db, userId, input.collectionId)
  }

  const colliding = db.select().from(ownedCard).where(sameTupleWhere(userId, input, id)).get()
  const now = new Date()

  if (colliding) {
    const [merged] = db
      .update(ownedCard)
      .set({
        quantity: colliding.quantity + input.quantity,
        note: input.note ?? colliding.note,
        updatedAt: now,
      })
      .where(eq(ownedCard.id, colliding.id))
      .returning()
      .all()
    db.delete(ownedCard).where(eq(ownedCard.id, id)).run()
    return merged!
  }

  const [updated] = db
    .update(ownedCard)
    .set({
      catalogCardId: input.catalogCardId,
      printingId: input.printingId,
      collectionId: input.collectionId,
      quantity: input.quantity,
      language: input.language,
      condition: input.condition,
      edition: input.edition,
      note: input.note,
      updatedAt: now,
    })
    .where(eq(ownedCard.id, id))
    .returning()
    .all()

  return updated!
}

export async function deleteOwnedCard(db: Db, userId: string, id: string) {
  const deleted = db
    .delete(ownedCard)
    .where(and(eq(ownedCard.id, id), eq(ownedCard.userId, userId)))
    .returning({ id: ownedCard.id })
    .all()

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Owned card not found' })
  }
}

export function listOwnedCards(db: Db, userId: string, options: InventoryListOptions = {}) {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20))
  const q = options.q?.trim()
  const clauses = [eq(ownedCard.userId, userId)]
  if (q) {
    clauses.push(like(catalogCard.name, `%${q}%`))
  }
  if (options.collectionId) {
    clauses.push(eq(ownedCard.collectionId, options.collectionId))
  }
  const where = and(...clauses)

  const rows = db
    .select({
      id: ownedCard.id,
      catalogCardId: ownedCard.catalogCardId,
      printingId: ownedCard.printingId,
      collectionId: ownedCard.collectionId,
      quantity: ownedCard.quantity,
      language: ownedCard.language,
      condition: ownedCard.condition,
      edition: ownedCard.edition,
      note: ownedCard.note,
      createdAt: ownedCard.createdAt,
      updatedAt: ownedCard.updatedAt,
      cardName: catalogCard.name,
      cardType: catalogCard.type,
      imageUrlSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
      setName: catalogSet.name,
      rarity: catalogPrinting.rarity,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .leftJoin(catalogPrinting, eq(ownedCard.printingId, catalogPrinting.id))
    .leftJoin(catalogSet, eq(catalogPrinting.setId, catalogSet.id))
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(where)
    .groupBy(ownedCard.id)
    .orderBy(desc(ownedCard.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const total = db
    .select({ count: sql<number>`count(distinct ${ownedCard.id})` })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .where(where)
    .get()?.count ?? 0

  return { items: rows, total, page, pageSize }
}

/**
 * Total owned copies per catalog card for one user, summed across every
 * collection, printing, condition, language, and edition (see docs/adr/0002:
 * deck availability is "a simple sum by catalog_card_id"). Cards the user
 * does not own at all are absent from the map.
 */
export function ownedQuantitiesByCard(db: Db, userId: string, catalogCardIds: number[]): Map<number, number> {
  if (catalogCardIds.length === 0) {
    return new Map()
  }

  const rows = db
    .select({
      catalogCardId: ownedCard.catalogCardId,
      owned: sql<number>`sum(${ownedCard.quantity})`,
    })
    .from(ownedCard)
    .where(and(eq(ownedCard.userId, userId), inArray(ownedCard.catalogCardId, catalogCardIds)))
    .groupBy(ownedCard.catalogCardId)
    .all()

  return new Map(rows.map(row => [row.catalogCardId, row.owned ?? 0]))
}

export function searchCatalogCards(db: Db, q = '') {
  const term = q.trim()
  const where = term
    ? or(like(catalogCard.name, `%${term}%`), like(sql`${catalogCard.id}`, `%${term}%`))
    : undefined

  const cards = db
    .select({
      id: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      imageUrlSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(catalogCard)
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(where)
    .groupBy(catalogCard.id)
    .orderBy(catalogCard.name)
    .limit(20)
    .all()

  if (cards.length === 0) {
    return []
  }

  const cardIds = new Set(cards.map(card => card.id))
  const printings = db
    .select({
      id: catalogPrinting.id,
      cardId: catalogPrinting.cardId,
      setName: catalogSet.name,
      rarity: catalogPrinting.rarity,
    })
    .from(catalogPrinting)
    .innerJoin(catalogSet, eq(catalogPrinting.setId, catalogSet.id))
    .all()
    .filter(printing => cardIds.has(printing.cardId))

  return cards.map(card => ({
    ...card,
    printings: printings.filter(printing => printing.cardId === card.id),
  }))
}
