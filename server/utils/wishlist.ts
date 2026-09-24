import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, wishlistItem } from '../db/schema'
import { ownedQuantitiesByCard } from './inventory'
import { cardNameMatches } from './card-name-search'
import type { WishlistItemView, WishlistResponse, WishlistVisibility } from '../../shared/sharing'

type Db = ReturnType<typeof useDb>

export const WISHLIST_NOTE_MAX_LENGTH = 200
export const MAX_WISHLIST_QUANTITY = 99

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 100

export interface WishlistInput { catalogCardId: number, quantity: number, note: string | null }
export type WishlistUpdateInput = Partial<Omit<WishlistInput, 'catalogCardId'>>
export interface WishlistListOptions { q?: string, page?: number, pageSize?: number }
export type WishlistPage = WishlistResponse

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

// `data.code` is what the UI translates (`errors.api.<code>`, ADR 0014).
function notFound(message = 'Wishlist item not found'): never {
  throw createError({ statusCode: 404, statusMessage: message, data: { code: 'wishlist_item_not_found' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCatalogCardId(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    badRequest('catalog_card_id is required')
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    badRequest('catalog_card_id must be a positive integer')
  }
  return numberValue
}

function normalizeQuantity(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < 1 || numberValue > MAX_WISHLIST_QUANTITY) {
    badRequest(`quantity must be between 1 and ${MAX_WISHLIST_QUANTITY}`)
  }
  return numberValue
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string') {
    badRequest(`note must be at most ${WISHLIST_NOTE_MAX_LENGTH} characters`)
  }
  const trimmed = value.trim()
  if (trimmed.length > WISHLIST_NOTE_MAX_LENGTH) {
    badRequest(`note must be at most ${WISHLIST_NOTE_MAX_LENGTH} characters`)
  }
  return trimmed === '' ? null : trimmed
}

/**
 * Accepts catalogCardId | catalog_card_id (mirroring validateInventoryInput).
 * 400 'catalog_card_id is required'   / 'catalog_card_id must be a positive integer'
 * 400 'quantity must be between 1 and 99'
 * 400 'note must be at most 200 characters'
 * quantity defaults to 1, note to null.
 */
export function validateWishlistInput(body: unknown): WishlistInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  return {
    catalogCardId: normalizeCatalogCardId(body.catalog_card_id ?? body.catalogCardId),
    quantity: normalizeQuantity(body.quantity, 1),
    note: normalizeNote(body.note),
  }
}

export function validateWishlistUpdateInput(body: unknown): WishlistUpdateInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: WishlistUpdateInput = {}
  if (body.quantity !== undefined) {
    input.quantity = normalizeQuantity(body.quantity, 1)
  }
  if (body.note !== undefined) {
    input.note = normalizeNote(body.note)
  }

  return input
}

// Distinct message from server/utils/inventory.ts ensureCatalogCardExists
// ('catalog_card_id does not exist'), which other endpoints already assert
// on; the wishlist wording is specified separately.
function ensureCatalogCardKnown(db: Db, catalogCardId: number) {
  const card = db.select({ id: catalogCard.id }).from(catalogCard).where(eq(catalogCard.id, catalogCardId)).get()
  if (!card) {
    badRequest('catalog_card_id does not reference a known card')
  }
}

function buildWishlistItemView(
  db: Db,
  userId: string,
  row: typeof wishlistItem.$inferSelect,
  opts: { includeOwned: boolean },
): WishlistItemView {
  const card = db
    .select({
      name: catalogCard.name,
      type: catalogCard.type,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(catalogCard)
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(eq(catalogCard.id, row.catalogCardId))
    .groupBy(catalogCard.id)
    .get()!

  const view: WishlistItemView = {
    id: row.id,
    catalogCardId: row.catalogCardId,
    name: card.name,
    type: card.type,
    imageSmall: card.imageSmall,
    quantity: row.quantity,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }

  if (opts.includeOwned) {
    const owned = ownedQuantitiesByCard(db, userId, [row.catalogCardId])
    view.owned = owned.get(row.catalogCardId) ?? 0
  }

  return view
}

/**
 * Upsert on (userId, catalogCardId): an existing row is *set* to the new
 * quantity/note, not incremented — "Zur Wunschliste" stays idempotent.
 * 400 'catalog_card_id does not reference a known card' when unknown.
 */
export function addWishlistItem(db: Db, userId: string, input: WishlistInput): WishlistItemView {
  ensureCatalogCardKnown(db, input.catalogCardId)

  const now = new Date()
  const existing = db
    .select()
    .from(wishlistItem)
    .where(and(eq(wishlistItem.userId, userId), eq(wishlistItem.catalogCardId, input.catalogCardId)))
    .get()

  const row = existing
    ? db.update(wishlistItem)
        .set({ quantity: input.quantity, note: input.note, updatedAt: now })
        .where(eq(wishlistItem.id, existing.id))
        .returning()
        .get()
    : db.insert(wishlistItem)
        .values({
          id: randomUUID(),
          userId,
          catalogCardId: input.catalogCardId,
          quantity: input.quantity,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()

  return buildWishlistItemView(db, userId, row!, { includeOwned: true })
}

export function updateWishlistItem(db: Db, userId: string, id: string, patch: WishlistUpdateInput): WishlistItemView {
  const current = db
    .select()
    .from(wishlistItem)
    .where(and(eq(wishlistItem.id, id), eq(wishlistItem.userId, userId)))
    .get()

  if (!current) {
    notFound()
  }

  const now = new Date()
  const updated = db
    .update(wishlistItem)
    .set({
      quantity: patch.quantity ?? current.quantity,
      note: patch.note !== undefined ? patch.note : current.note,
      updatedAt: now,
    })
    .where(eq(wishlistItem.id, id))
    .returning()
    .get()

  return buildWishlistItemView(db, userId, updated!, { includeOwned: true })
}

export function removeWishlistItem(db: Db, userId: string, id: string): void {
  const deleted = db
    .delete(wishlistItem)
    .where(and(eq(wishlistItem.id, id), eq(wishlistItem.userId, userId)))
    .returning({ id: wishlistItem.id })
    .all()

  if (deleted.length === 0) {
    notFound()
  }
}

export function removeWishlistItemByCard(db: Db, userId: string, catalogCardId: number): void {
  const deleted = db
    .delete(wishlistItem)
    .where(and(eq(wishlistItem.userId, userId), eq(wishlistItem.catalogCardId, catalogCardId)))
    .returning({ id: wishlistItem.id })
    .all()

  if (deleted.length === 0) {
    notFound()
  }
}

function wishlistCardRowsQuery(db: Db, where: SQL, page: number, pageSize: number) {
  return db
    .select({
      id: wishlistItem.id,
      catalogCardId: wishlistItem.catalogCardId,
      quantity: wishlistItem.quantity,
      note: wishlistItem.note,
      createdAt: wishlistItem.createdAt,
      updatedAt: wishlistItem.updatedAt,
      name: catalogCard.name,
      type: catalogCard.type,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(wishlistItem)
    .innerJoin(catalogCard, eq(wishlistItem.catalogCardId, catalogCard.id))
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(where)
    .groupBy(wishlistItem.id)
    .orderBy(asc(catalogCard.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
}

function wishlistCardTotal(db: Db, where: SQL): number {
  return db
    .select({ count: sql<number>`count(distinct ${wishlistItem.id})` })
    .from(wishlistItem)
    .innerJoin(catalogCard, eq(wishlistItem.catalogCardId, catalogCard.id))
    .where(where)
    .get()?.count ?? 0
}

/** Owner view: adds `owned` (ownedQuantitiesByCard) so "already have 1 of 3" is visible. */
export function listWishlist(db: Db, userId: string, options: WishlistListOptions = {}): WishlistPage {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const q = options.q?.trim()

  const clauses: SQL[] = [eq(wishlistItem.userId, userId)]
  if (q) {
    clauses.push(cardNameMatches(q))
  }
  const where = and(...clauses) as SQL

  const rows = wishlistCardRowsQuery(db, where, page, pageSize)
  const total = wishlistCardTotal(db, where)
  const owned = ownedQuantitiesByCard(db, userId, rows.map(row => row.catalogCardId))

  return {
    items: rows.map(row => ({
      id: row.id,
      catalogCardId: row.catalogCardId,
      name: row.name,
      type: row.type,
      imageSmall: row.imageSmall,
      quantity: row.quantity,
      note: row.note,
      owned: owned.get(row.catalogCardId) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  }
}

/** Public view: identical rows minus `owned`; `note` stays (the "looking for" hint). */
export function listPublicWishlist(db: Db, ownerUserId: string, options: { page?: number, pageSize?: number } = {}): WishlistPage {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const where = eq(wishlistItem.userId, ownerUserId)

  const rows = wishlistCardRowsQuery(db, where, page, pageSize)
  const total = wishlistCardTotal(db, where)

  return {
    items: rows.map(row => ({
      id: row.id,
      catalogCardId: row.catalogCardId,
      name: row.name,
      type: row.type,
      imageSmall: row.imageSmall,
      quantity: row.quantity,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  }
}

/**
 * Whether `viewerUserId` may see `ownerUserId`'s wishlist: the owner always
 * can, everyone else only while it is 'public'. Pure and dependency-free so
 * both /api/profiles/:handle (the teaser count) and
 * /api/profiles/:handle/wishlist (the item list, which 404s otherwise) can
 * share and unit-test the same gate instead of duplicating the condition.
 */
export function canViewWishlist(
  ownerUserId: string,
  wishlistVisibility: WishlistVisibility,
  viewerUserId: string | null,
): boolean {
  return viewerUserId === ownerUserId || wishlistVisibility === 'public'
}

/** Row count for one user's wishlist — the public-profile teaser count. */
export function wishlistItemCount(db: Db, userId: string): number {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(wishlistItem)
    .where(eq(wishlistItem.userId, userId))
    .get()?.count ?? 0
}

/** Catalog-page toggle state: the caller's wishlisted catalog card ids. */
export function wishlistCardIds(db: Db, userId: string): number[] {
  return db
    .select({ catalogCardId: wishlistItem.catalogCardId })
    .from(wishlistItem)
    .where(eq(wishlistItem.userId, userId))
    .all()
    .map(row => row.catalogCardId)
}
