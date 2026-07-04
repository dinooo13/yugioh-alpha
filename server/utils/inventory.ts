import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, like, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import {
  catalogCard,
  catalogCardImage,
  catalogPrinting,
  catalogSet,
  ownedCard,
} from '../db/schema'

type Db = ReturnType<typeof useDb>

export const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja', 'ko'] as const
export const CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'] as const
export const EDITIONS = ['first', 'unlimited', 'limited'] as const

export type InventoryLanguage = typeof LANGUAGES[number]
export type InventoryCondition = typeof CONDITIONS[number]
export type InventoryEdition = typeof EDITIONS[number]

export interface InventoryInput {
  catalogCardId: number
  printingId: string | null
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
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePositiveInteger(value: unknown, field: string, fallback?: number): number {
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
    quantity: normalizePositiveInteger(body.quantity, 'quantity', 1),
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
  if (body.quantity !== undefined) {
    input.quantity = normalizePositiveInteger(body.quantity, 'quantity')
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

export async function ensureCatalogCardExists(db: Db, catalogCardId: number, printingId?: string | null) {
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
    eq(ownedCard.language, input.language),
    eq(ownedCard.condition, input.condition),
    eq(ownedCard.edition, input.edition),
  ]

  if (exceptId) {
    clauses.push(ne(ownedCard.id, exceptId))
  }

  return and(...clauses)
}

export async function addOwnedCard(db: Db, userId: string, input: InventoryInput) {
  await ensureCatalogCardExists(db, input.catalogCardId, input.printingId)

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
    return updated!
  }

  const [created] = db
    .insert(ownedCard)
    .values({
      id: randomUUID(),
      userId,
      catalogCardId: input.catalogCardId,
      printingId: input.printingId,
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

  return created!
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
    quantity: patch.quantity ?? current.quantity,
    language: patch.language ?? (current.language as InventoryLanguage),
    condition: patch.condition ?? (current.condition as InventoryCondition),
    edition: patch.edition ?? (current.edition as InventoryEdition),
    note: patch.note !== undefined ? patch.note : current.note,
  }

  await ensureCatalogCardExists(db, input.catalogCardId, input.printingId)

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
  const where = q
    ? and(eq(ownedCard.userId, userId), like(catalogCard.name, `%${q}%`))
    : eq(ownedCard.userId, userId)

  const rows = db
    .select({
      id: ownedCard.id,
      catalogCardId: ownedCard.catalogCardId,
      printingId: ownedCard.printingId,
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
