import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { createError } from 'h3'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, deck, deckCard, ruleFormat } from '../db/schema'
import { ownedQuantitiesByCard } from './inventory'
import { evaluateDeck } from '../../shared/rule-formats'
import type { DeckValidation, RuleSet } from '../../shared/rule-formats'
import { pluralize } from '../../shared/plural'
import { loadCardDataForValidation } from './deck-validation'
import { requireAssignableFormat, ruleFormatsById } from './rule-formats'
import { deleteGrantsForResource } from './sharing'
import {
  allowedSectionsForCard,
  DECK_LIMITS,
  DECK_SECTIONS,
  defaultSectionForCard,
  isExtraDeckCard,
  isSectionAllowedForCard,
} from '../../shared/deck-sections'
import type { DeckSection, DeckSectionCard } from '../../shared/deck-sections'
import type { Visibility } from '../../shared/sharing'
import type { DeckCover } from '../../shared/deck-cover'

type Db = ReturnType<typeof useDb>

export {
  allowedSectionsForCard,
  DECK_LIMITS,
  DECK_SECTIONS,
  defaultSectionForCard,
  isExtraDeckCard,
  isSectionAllowedForCard,
}
export type { DeckCover, DeckSection, DeckSectionCard }

export const DECK_NAME_MAX_LENGTH = 80
export const DECK_DESCRIPTION_MAX_LENGTH = 500

// Sanity cap on a single deck_card row, not a format rule: nobody plays 100
// copies of a card, and it keeps a typo/scripted call from bloating a deck.
// The *format* copy limit (DECK_LIMITS.maxCopies) stays a warning.
export const MAX_DECK_CARD_QUANTITY = 99

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 60

export type DeckListSort = 'name' | '-name' | 'newest' | 'updated'

const DECK_LIST_SORTS: readonly DeckListSort[] = ['name', '-name', 'newest', 'updated']

export interface DeckInput {
  name: string
  description: string | null
}

export interface DeckFormatRef {
  id: string
  name: string
  isBuiltin: boolean
}

export interface DeckCardInput {
  catalogCardId: number
  section: DeckSection
  // 0 removes the row (see upsertDeckCard).
  quantity: number
}

export interface DeckCardMoveInput {
  catalogCardId: number
  from: DeckSection
  to: DeckSection
  quantity?: number
}

export interface DeckListOptions {
  q?: string
  sort?: DeckListSort
  page?: number
  pageSize?: number
  contains?: number
  /** A format id, or 'none' for decks without a format. */
  formatId?: string
  /** Only decks that are legal (true) / not legal (false) in their format. */
  legal?: boolean
}

export interface DeckCardRow {
  catalogCardId: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  section: DeckSection
  quantity: number
  /** Copies the user owns in total (all collections/conditions/languages). */
  owned: number
  /** Copies used across all sections of *this* deck. */
  usedInDeck: number
  shortfall: number
}

export interface DeckWarning {
  code: string
  message: string
  cardId?: number
}

export interface DeckDetail {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  sections: Record<DeckSection, DeckCardRow[]>
  counts: { main: number, extra: number, side: number, total: number }
  limits: typeof DECK_LIMITS
  /** Informational structural hints, independent of any rule format. */
  warnings: DeckWarning[]
  /** The assigned rule format, or null when the deck has none. */
  format: DeckFormatRef | null
  /** Recomputed on every read/write; null while no format is assigned. */
  validation: DeckValidation | null
  /** Sharing state (Phase 6). */
  visibility: Visibility
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function notFound(message = 'Deck not found'): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Escapes SQLite LIKE wildcards so a user's search term matches literally.
function escapeLikeTerm(term: string): string {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function likeCondition(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} like ${pattern} escape '\\'`
}

export function validateDeckInput(body: unknown): DeckInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawName = body.name
  if (typeof rawName !== 'string') {
    badRequest('name is required')
  }

  const name = rawName.trim()
  if (name === '') {
    badRequest('name is required')
  }
  if (name.length > DECK_NAME_MAX_LENGTH) {
    badRequest(`name must be at most ${DECK_NAME_MAX_LENGTH} characters`)
  }

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      badRequest('description must be a string')
    }
    const trimmed = body.description.trim()
    if (trimmed.length > DECK_DESCRIPTION_MAX_LENGTH) {
      badRequest(`description must be at most ${DECK_DESCRIPTION_MAX_LENGTH} characters`)
    }
    description = trimmed === '' ? null : trimmed
  }

  return { name, description }
}

export interface DeckUpdateInput extends Partial<DeckInput> {
  /** `null` removes the format assignment (validation off). */
  formatId?: string | null
}

export function validateDeckUpdateInput(body: unknown): DeckUpdateInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: DeckUpdateInput = {}
  if (body.name !== undefined) {
    input.name = validateDeckInput({ name: body.name }).name
  }
  if (body.description !== undefined) {
    input.description = validateDeckInput({ name: 'placeholder', description: body.description }).description
  }

  const rawFormatId = body.format_id !== undefined ? body.format_id : body.formatId
  if (rawFormatId !== undefined) {
    if (rawFormatId === null || rawFormatId === '') {
      input.formatId = null
    }
    else if (typeof rawFormatId !== 'string') {
      badRequest('format_id must be a string or null')
    }
    else {
      input.formatId = rawFormatId
    }
  }

  return input
}

function normalizeCatalogCardId(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    badRequest('catalog_card_id must be a positive integer')
  }
  return numberValue
}

function normalizeSection(value: unknown, field = 'section'): DeckSection {
  if (typeof value !== 'string' || !(DECK_SECTIONS as readonly string[]).includes(value)) {
    badRequest(`${field} must be one of ${DECK_SECTIONS.join(', ')}`)
  }
  return value as DeckSection
}

function normalizeQuantity(value: unknown, { allowZero }: { allowZero: boolean }): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < (allowZero ? 0 : 1)) {
    badRequest(allowZero
      ? 'quantity must be a non-negative integer'
      : 'quantity must be a positive integer')
  }
  if (numberValue > MAX_DECK_CARD_QUANTITY) {
    badRequest(`quantity must be at most ${MAX_DECK_CARD_QUANTITY}`)
  }
  return numberValue
}

export function validateDeckCardInput(body: unknown): DeckCardInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawQuantity = body.quantity
  return {
    catalogCardId: normalizeCatalogCardId(body.catalog_card_id ?? body.catalogCardId),
    section: normalizeSection(body.section),
    // `quantity` is optional and defaults to 1; 0 removes the row.
    quantity: rawQuantity === undefined || rawQuantity === null || rawQuantity === ''
      ? 1
      : normalizeQuantity(rawQuantity, { allowZero: true }),
  }
}

// Upper bound on how many card rows a single `POST /api/decks` request may
// seed the new deck with (an AI deck-assistant "build" suggestion, say).
export const MAX_DECK_CREATE_CARDS = 100

/**
 * Validates the optional `cards` array on deck creation — one entry per
 * (catalog_card_id, section), using the same per-item rules as the card
 * upsert endpoint (unknown card, section rule, 1..99 quantity), except a
 * create-time entry may not use quantity 0 (there is nothing to remove yet).
 * Returns `undefined` when the request carries no `cards` field at all, so
 * `PATCH` (which never reads this key) is unaffected.
 */
export function validateDeckCreateCardsInput(body: unknown): DeckCardInput[] | undefined {
  if (!isRecord(body) || body.cards === undefined) {
    return undefined
  }

  const rawCards = body.cards
  if (!Array.isArray(rawCards)) {
    badRequest('cards must be an array')
  }
  if (rawCards.length > MAX_DECK_CREATE_CARDS) {
    badRequest(`cards must contain at most ${MAX_DECK_CREATE_CARDS} entries`)
  }

  return rawCards.map((rawCard) => {
    if (!isRecord(rawCard)) {
      badRequest('Each entry in cards must be an object')
    }
    return {
      catalogCardId: normalizeCatalogCardId(rawCard.catalog_card_id ?? rawCard.catalogCardId),
      section: normalizeSection(rawCard.section),
      quantity: normalizeQuantity(rawCard.quantity, { allowZero: false }),
    }
  })
}

export function validateDeckCardMoveInput(body: unknown): DeckCardMoveInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const from = normalizeSection(body.from, 'from')
  const to = normalizeSection(body.to, 'to')
  if (from === to) {
    badRequest('from and to must be different sections')
  }

  const rawQuantity = body.quantity
  return {
    catalogCardId: normalizeCatalogCardId(body.catalog_card_id ?? body.catalogCardId),
    from,
    to,
    quantity: rawQuantity === undefined || rawQuantity === null || rawQuantity === ''
      ? undefined
      : normalizeQuantity(rawQuantity, { allowZero: false }),
  }
}

export function parseDeckListQuery(rawQuery: Record<string, unknown>): DeckListOptions {
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value)

  const rawSort = first(rawQuery.sort)
  const sort = typeof rawSort === 'string' && (DECK_LIST_SORTS as readonly string[]).includes(rawSort)
    ? rawSort as DeckListSort
    : undefined

  const rawQ = first(rawQuery.q)
  const rawContains = Number(first(rawQuery.contains ?? rawQuery.containsCardId))
  const page = Number(first(rawQuery.page))
  const pageSize = Number(first(rawQuery.pageSize))

  const rawFormatId = first(rawQuery.formatId ?? rawQuery.format_id)
  const rawLegal = first(rawQuery.legal)

  return {
    q: typeof rawQ === 'string' && rawQ.trim() !== '' ? rawQ.trim() : undefined,
    sort,
    contains: Number.isInteger(rawContains) && rawContains > 0 ? rawContains : undefined,
    page: Number.isInteger(page) && page > 0 ? page : undefined,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : undefined,
    formatId: typeof rawFormatId === 'string' && rawFormatId.trim() !== '' ? rawFormatId.trim() : undefined,
    legal: rawLegal === '1' || rawLegal === 'true' || rawLegal === true
      ? true
      : rawLegal === '0' || rawLegal === 'false' || rawLegal === false
        ? false
        : undefined,
  }
}

function requireDeckRow(db: Db, userId: string, deckId: string) {
  const row = db
    .select()
    .from(deck)
    .where(and(eq(deck.id, deckId), eq(deck.userId, userId)))
    .get()

  // A deck the caller doesn't own is indistinguishable from a missing one
  // (ownership boundary, see docs/adr/0002 and 0004).
  if (!row) {
    notFound()
  }

  return row
}

function requireCatalogCard(db: Db, catalogCardId: number) {
  const card = db
    .select({ id: catalogCard.id, name: catalogCard.name, type: catalogCard.type, frameType: catalogCard.frameType })
    .from(catalogCard)
    .where(eq(catalogCard.id, catalogCardId))
    .get()

  if (!card) {
    badRequest('catalog_card_id does not exist')
  }

  return card
}

function assertSectionAllowed(card: DeckSectionCard, section: DeckSection) {
  if (!isSectionAllowedForCard(card, section)) {
    badRequest(isExtraDeckCard(card)
      ? 'Extra deck cards can only be placed in the extra or side section'
      : 'Main deck cards can only be placed in the main or side section')
  }
}

// Monsters first, then spells, then traps — the conventional deck-list order.
// Exported for reuse by server/utils/shared-views.ts (the shared deck view
// sorts sections identically to buildDeckDetail).
export function cardCategoryRank(type: string): number {
  if (type.toLowerCase().includes('spell')) {
    return 1
  }
  if (type.toLowerCase().includes('trap')) {
    return 2
  }
  return 0
}

// Exported for reuse by server/utils/shared-views.ts: warnings are computed
// from counts/quantities only (no ownership data), so they are safe to reuse
// verbatim in the shared (read-only) deck view.
export function buildWarnings(
  counts: { main: number, extra: number, side: number },
  rows: Array<{ catalogCardId: number, name: string, quantity: number }>,
): DeckWarning[] {
  const warnings: DeckWarning[] = []

  if (counts.main < DECK_LIMITS.mainMin) {
    warnings.push({
      code: 'main_below_min',
      message: `Das Main Deck hat ${pluralize(counts.main, 'Karte', 'Karten')}, mindestens ${DECK_LIMITS.mainMin} sind üblich.`,
    })
  }
  if (counts.main > DECK_LIMITS.mainMax) {
    warnings.push({
      code: 'main_above_max',
      message: `Das Main Deck hat ${pluralize(counts.main, 'Karte', 'Karten')}, höchstens ${DECK_LIMITS.mainMax} sind üblich.`,
    })
  }
  if (counts.extra > DECK_LIMITS.extraMax) {
    warnings.push({
      code: 'extra_above_max',
      message: `Das Extra Deck hat ${pluralize(counts.extra, 'Karte', 'Karten')}, höchstens ${DECK_LIMITS.extraMax} sind üblich.`,
    })
  }
  if (counts.side > DECK_LIMITS.sideMax) {
    warnings.push({
      code: 'side_above_max',
      message: `Das Side Deck hat ${pluralize(counts.side, 'Karte', 'Karten')}, höchstens ${DECK_LIMITS.sideMax} sind üblich.`,
    })
  }

  // The standard copy limit counts every copy in the deck — main, extra, and
  // side combined.
  const copiesByCard = new Map<number, { name: string, copies: number }>()
  for (const row of rows) {
    const entry = copiesByCard.get(row.catalogCardId) ?? { name: row.name, copies: 0 }
    entry.copies += row.quantity
    copiesByCard.set(row.catalogCardId, entry)
  }

  for (const [cardId, entry] of copiesByCard) {
    if (entry.copies > DECK_LIMITS.maxCopies) {
      warnings.push({
        code: 'copies_above_max',
        cardId,
        message: `${entry.name}: ${entry.copies} Kopien im Deck, höchstens ${DECK_LIMITS.maxCopies} sind üblich.`,
      })
    }
  }

  return warnings
}

function loadDeckCardRows(db: Db, userId: string, deckId: string): DeckCardRow[] {
  const rows = db
    .select({
      catalogCardId: deckCard.catalogCardId,
      section: deckCard.section,
      quantity: deckCard.quantity,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(deckCard)
    .innerJoin(catalogCard, eq(deckCard.catalogCardId, catalogCard.id))
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(eq(deckCard.deckId, deckId))
    .groupBy(deckCard.id)
    .all()

  const owned = ownedQuantitiesByCard(db, userId, rows.map(row => row.catalogCardId))

  const usedByCard = new Map<number, number>()
  for (const row of rows) {
    usedByCard.set(row.catalogCardId, (usedByCard.get(row.catalogCardId) ?? 0) + row.quantity)
  }

  return rows.map((row) => {
    const ownedQuantity = owned.get(row.catalogCardId) ?? 0
    const usedInDeck = usedByCard.get(row.catalogCardId) ?? 0
    return {
      ...row,
      section: row.section as DeckSection,
      owned: ownedQuantity,
      usedInDeck,
      shortfall: Math.max(0, usedInDeck - ownedQuantity),
    }
  })
}

/**
 * Runs the rule engine for a deck. Returns `null` when the deck has no format
 * assigned — "no format" means "no legality statement", not "legal".
 */
function buildValidation(
  db: Db,
  rules: RuleSet | undefined,
  rows: Array<{ catalogCardId: number, section: DeckSection, quantity: number, name: string }>,
): DeckValidation | null {
  if (!rules) {
    return null
  }

  const cardData = loadCardDataForValidation(db, rows.map(row => row.catalogCardId))
  const cardNames = Object.fromEntries(rows.map(row => [row.catalogCardId, row.name]))

  return evaluateDeck(
    rules,
    rows.map(row => ({ catalogCardId: row.catalogCardId, section: row.section, quantity: row.quantity })),
    cardData,
    { cardNames },
  )
}

function buildDeckDetail(db: Db, userId: string, deckRow: typeof deck.$inferSelect): DeckDetail {
  const rows = loadDeckCardRows(db, userId, deckRow.id)

  const formatRow = deckRow.formatId
    ? db
        .select({
          id: ruleFormat.id,
          name: ruleFormat.name,
          isBuiltin: ruleFormat.isBuiltin,
          rules: ruleFormat.rules,
        })
        .from(ruleFormat)
        .where(eq(ruleFormat.id, deckRow.formatId))
        .get()
    : undefined

  const sections: Record<DeckSection, DeckCardRow[]> = { main: [], extra: [], side: [] }
  for (const row of rows) {
    sections[row.section].push(row)
  }

  sections.main.sort((a, b) =>
    cardCategoryRank(a.type) - cardCategoryRank(b.type) || a.name.localeCompare(b.name))
  sections.extra.sort((a, b) => a.name.localeCompare(b.name))
  sections.side.sort((a, b) => a.name.localeCompare(b.name))

  const sum = (section: DeckSection) =>
    sections[section].reduce((total, row) => total + row.quantity, 0)

  const counts = { main: sum('main'), extra: sum('extra'), side: sum('side'), total: 0 }
  counts.total = counts.main + counts.extra + counts.side

  return {
    id: deckRow.id,
    name: deckRow.name,
    description: deckRow.description,
    createdAt: deckRow.createdAt,
    updatedAt: deckRow.updatedAt,
    sections,
    counts,
    limits: DECK_LIMITS,
    warnings: buildWarnings(counts, rows),
    format: formatRow
      ? { id: formatRow.id, name: formatRow.name, isBuiltin: formatRow.isBuiltin }
      : null,
    validation: buildValidation(db, formatRow?.rules, rows),
    visibility: deckRow.visibility,
  }
}

export function getDeckDetail(db: Db, userId: string, deckId: string): DeckDetail {
  return buildDeckDetail(db, userId, requireDeckRow(db, userId, deckId))
}

/**
 * Validates one of the caller's decks against an arbitrary rule set, without
 * assigning it — the format editor's "Deck prüfen" preview and
 * `GET /api/decks/:id/validate`.
 */
export function validateDeckWithRules(db: Db, userId: string, deckId: string, rules: RuleSet): DeckValidation {
  const deckRow = requireDeckRow(db, userId, deckId)

  const rows = db
    .select({
      catalogCardId: deckCard.catalogCardId,
      section: deckCard.section,
      quantity: deckCard.quantity,
      name: catalogCard.name,
    })
    .from(deckCard)
    .innerJoin(catalogCard, eq(deckCard.catalogCardId, catalogCard.id))
    .where(eq(deckCard.deckId, deckRow.id))
    .all()

  return buildValidation(db, rules, rows.map(row => ({ ...row, section: row.section as DeckSection })))!
}

/**
 * Creates a deck, optionally seeded with a set of cards (e.g. an AI deck
 * assistant "build" suggestion saved directly) — the deck row and every card
 * row are written in one transaction, so a bad card never leaves behind an
 * empty deck.
 */
export function createDeck(db: Db, userId: string, input: DeckInput, cards?: DeckCardInput[]): DeckDetail {
  const now = new Date()

  const created = db.transaction((tx) => {
    const txDb = tx as unknown as Db
    const [createdDeck] = txDb
      .insert(deck)
      .values({
        id: randomUUID(),
        userId,
        name: input.name,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    if (cards && cards.length > 0) {
      // Merge duplicate (catalogCardId, section) entries before validating
      // section/existence, same as the card upsert would end up doing.
      const merged = new Map<string, DeckCardInput>()
      for (const cardInput of cards) {
        const card = requireCatalogCard(txDb, cardInput.catalogCardId)
        assertSectionAllowed(card, cardInput.section)

        const key = `${cardInput.catalogCardId}:${cardInput.section}`
        const existing = merged.get(key)
        if (existing) {
          existing.quantity = Math.min(MAX_DECK_CARD_QUANTITY, existing.quantity + cardInput.quantity)
        }
        else {
          merged.set(key, { ...cardInput })
        }
      }

      txDb.insert(deckCard).values([...merged.values()].map(cardInput => ({
        id: randomUUID(),
        deckId: createdDeck!.id,
        catalogCardId: cardInput.catalogCardId,
        section: cardInput.section,
        quantity: cardInput.quantity,
        createdAt: now,
        updatedAt: now,
      }))).run()
    }

    return createdDeck!
  })

  return buildDeckDetail(db, userId, created)
}

export function updateDeck(db: Db, userId: string, deckId: string, patch: DeckUpdateInput): DeckDetail {
  const current = requireDeckRow(db, userId, deckId)

  // An empty patch is a no-op, not a touch: `updatedAt` drives the default
  // list sorting, so it must only move when something actually changed.
  if (patch.name === undefined && patch.description === undefined && patch.formatId === undefined) {
    return buildDeckDetail(db, userId, current)
  }

  // Only a built-in or one of the caller's own formats may be assigned.
  if (typeof patch.formatId === 'string') {
    requireAssignableFormat(db, userId, patch.formatId)
  }

  const [updated] = db
    .update(deck)
    .set({
      name: patch.name ?? current.name,
      description: patch.description !== undefined ? patch.description : current.description,
      formatId: patch.formatId !== undefined ? patch.formatId : current.formatId,
      updatedAt: new Date(),
    })
    .where(eq(deck.id, deckId))
    .returning()
    .all()

  return buildDeckDetail(db, userId, updated!)
}

export function deleteDeck(db: Db, userId: string, deckId: string) {
  const deleted = db
    .delete(deck)
    .where(and(eq(deck.id, deckId), eq(deck.userId, userId)))
    .returning({ id: deck.id })
    .all()

  if (deleted.length === 0) {
    notFound()
  }

  deleteGrantsForResource(db, 'deck', deckId)
}

export function duplicateDeck(db: Db, userId: string, deckId: string): DeckDetail {
  const source = requireDeckRow(db, userId, deckId)
  const now = new Date()

  const [copy] = db
    .insert(deck)
    .values({
      id: randomUUID(),
      userId,
      name: duplicateNameFor(source.name),
      description: source.description,
      formatId: source.formatId,
      // The copy never inherits a share: always private with no token.
      visibility: 'private',
      shareToken: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all()

  const sourceCards = db.select().from(deckCard).where(eq(deckCard.deckId, deckId)).all()
  if (sourceCards.length > 0) {
    db.insert(deckCard).values(sourceCards.map(row => ({
      id: randomUUID(),
      deckId: copy!.id,
      catalogCardId: row.catalogCardId,
      section: row.section,
      quantity: row.quantity,
      // Keep each row's original "added at" so the copy gets the same
      // (first-added) cover card as the source deck (#29).
      createdAt: row.createdAt,
      updatedAt: now,
    }))).run()
  }

  return buildDeckDetail(db, userId, copy!)
}

// Truncates the base name (not the suffix) so a duplicate always stays
// recognizable as a copy within the 80 character name limit.
export function duplicateNameFor(name: string): string {
  const suffix = ' (Kopie)'
  return `${name.slice(0, DECK_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`
}

function touchDeck(db: Db, deckId: string, now: Date) {
  db.update(deck).set({ updatedAt: now }).where(eq(deck.id, deckId)).run()
}

function findDeckCard(db: Db, deckId: string, catalogCardId: number, section: DeckSection) {
  return db
    .select()
    .from(deckCard)
    .where(and(
      eq(deckCard.deckId, deckId),
      eq(deckCard.catalogCardId, catalogCardId),
      eq(deckCard.section, section),
    ))
    .get()
}

/**
 * Sets the quantity of one catalog card in one section of a deck.
 * `quantity: 0` removes the row. Returns the refreshed deck detail so the
 * client never has to re-read after a write.
 */
export function upsertDeckCard(db: Db, userId: string, deckId: string, input: DeckCardInput): DeckDetail {
  const deckRow = requireDeckRow(db, userId, deckId)
  const card = requireCatalogCard(db, input.catalogCardId)
  assertSectionAllowed(card, input.section)

  const now = new Date()
  const existing = findDeckCard(db, deckId, input.catalogCardId, input.section)

  if (input.quantity === 0) {
    if (existing) {
      db.delete(deckCard).where(eq(deckCard.id, existing.id)).run()
    }
  }
  else if (existing) {
    db.update(deckCard)
      .set({ quantity: input.quantity, updatedAt: now })
      .where(eq(deckCard.id, existing.id))
      .run()
  }
  else {
    db.insert(deckCard).values({
      id: randomUUID(),
      deckId,
      catalogCardId: input.catalogCardId,
      section: input.section,
      quantity: input.quantity,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  touchDeck(db, deckId, now)
  return buildDeckDetail(db, userId, { ...deckRow, updatedAt: now })
}

export function moveDeckCard(db: Db, userId: string, deckId: string, input: DeckCardMoveInput): DeckDetail {
  const deckRow = requireDeckRow(db, userId, deckId)
  const card = requireCatalogCard(db, input.catalogCardId)
  assertSectionAllowed(card, input.to)

  const source = findDeckCard(db, deckId, input.catalogCardId, input.from)
  if (!source) {
    notFound('Deck card not found')
  }

  const quantity = input.quantity ?? source.quantity
  if (quantity > source.quantity) {
    badRequest('quantity exceeds the copies in the source section')
  }

  const now = new Date()
  if (quantity === source.quantity) {
    db.delete(deckCard).where(eq(deckCard.id, source.id)).run()
  }
  else {
    db.update(deckCard)
      .set({ quantity: source.quantity - quantity, updatedAt: now })
      .where(eq(deckCard.id, source.id))
      .run()
  }

  const target = findDeckCard(db, deckId, input.catalogCardId, input.to)
  if (target) {
    db.update(deckCard)
      .set({ quantity: target.quantity + quantity, updatedAt: now })
      .where(eq(deckCard.id, target.id))
      .run()
  }
  else {
    db.insert(deckCard).values({
      id: randomUUID(),
      deckId,
      catalogCardId: input.catalogCardId,
      section: input.to,
      quantity,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  touchDeck(db, deckId, now)
  return buildDeckDetail(db, userId, { ...deckRow, updatedAt: now })
}

export function removeDeckCard(
  db: Db,
  userId: string,
  deckId: string,
  catalogCardId: number,
  section: DeckSection,
): DeckDetail {
  const deckRow = requireDeckRow(db, userId, deckId)

  const deleted = db
    .delete(deckCard)
    .where(and(
      eq(deckCard.deckId, deckId),
      eq(deckCard.catalogCardId, catalogCardId),
      eq(deckCard.section, section),
    ))
    .returning({ id: deckCard.id })
    .all()

  if (deleted.length === 0) {
    notFound('Deck card not found')
  }

  const now = new Date()
  touchDeck(db, deckId, now)
  return buildDeckDetail(db, userId, { ...deckRow, updatedAt: now })
}

export interface DeckListItem {
  id: string
  name: string
  description: string | null
  mainCount: number
  extraCount: number
  sideCount: number
  cardCount: number
  /** True when every card in the deck is fully covered by owned copies. */
  complete: boolean
  missingCount: number
  formatId: string | null
  formatName: string | null
  /** Legality in the assigned format; `null` when no format is assigned. */
  legal: boolean | null
  createdAt: Date
  updatedAt: Date
  /** Sharing state (Phase 6). */
  visibility: Visibility
  /** Cover card for the deck tile (#29); `null` for a deck without Main/Extra cards. */
  cover: DeckCover | null
}

/** One Main/Extra Deck row considered for a deck's cover — see {@link pickDeckCover}. */
export interface DeckCoverCandidate extends DeckCover {
  section: DeckSection
  type: string
  createdAt: Date
}

function compareFirstAdded(a: DeckCoverCandidate, b: DeckCoverCandidate): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.catalogCardId - b.catalogCardId
}

/**
 * Picks a deck's cover card by the rule documented on {@link DeckCover}: the
 * first-added Main Deck monster, else the first-added Main Deck card, else
 * the first-added Extra Deck card, else `null`. Side Deck rows are ignored.
 * `deck_card.created_at` has second precision, so cards added together (a
 * deck created in one call, a duplicate) tie and fall back to the lower
 * catalog card id — stable, if arbitrary.
 */
export function pickDeckCover(rows: DeckCoverCandidate[]): DeckCover | null {
  const firstOf = (candidates: DeckCoverCandidate[]) => [...candidates].sort(compareFirstAdded)[0]

  const main = rows.filter(row => row.section === 'main')
  const picked = firstOf(main.filter(row => cardCategoryRank(row.type) === 0))
    ?? firstOf(main)
    ?? firstOf(rows.filter(row => row.section === 'extra'))

  if (!picked) {
    return null
  }
  return {
    catalogCardId: picked.catalogCardId,
    name: picked.name,
    imageSmall: picked.imageSmall,
    imageLarge: picked.imageLarge,
  }
}

/**
 * Cover cards for a set of decks in a single query (#29). Decks without a
 * cover are simply absent from the map. Callers must only pass deck ids the
 * viewer may already see — this does no access check of its own.
 */
export function loadDeckCovers(db: Db, deckIds: string[]): Map<string, DeckCover> {
  const covers = new Map<string, DeckCover>()
  if (deckIds.length === 0) {
    return covers
  }

  const rows = db
    .select({
      deckId: deckCard.deckId,
      catalogCardId: deckCard.catalogCardId,
      section: deckCard.section,
      createdAt: deckCard.createdAt,
      name: catalogCard.name,
      type: catalogCard.type,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
      imageLarge: sql<string | null>`min(${catalogCardImage.imageUrl})`,
    })
    .from(deckCard)
    .innerJoin(catalogCard, eq(deckCard.catalogCardId, catalogCard.id))
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(and(inArray(deckCard.deckId, deckIds), inArray(deckCard.section, ['main', 'extra'])))
    .groupBy(deckCard.id)
    .all()

  const rowsByDeck = new Map<string, DeckCoverCandidate[]>()
  for (const { deckId, ...row } of rows) {
    const candidates = rowsByDeck.get(deckId) ?? []
    candidates.push({ ...row, section: row.section as DeckSection })
    rowsByDeck.set(deckId, candidates)
  }

  for (const [deckId, candidates] of rowsByDeck) {
    const cover = pickDeckCover(candidates)
    if (cover) {
      covers.set(deckId, cover)
    }
  }
  return covers
}

// Upper bound on the decks scanned when filtering by legality: legality is
// computed, not stored, so that filter cannot be pushed into SQL.
const MAX_LEGALITY_SCAN = 500

export function listDecks(db: Db, userId: string, options: DeckListOptions = {}) {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const clauses: SQL[] = [eq(deck.userId, userId)]

  const q = options.q?.trim()
  if (q) {
    const pattern = `%${escapeLikeTerm(q)}%`
    // Matches the deck name or the name of any card contained in the deck.
    clauses.push(or(
      likeCondition(deck.name, pattern),
      sql`exists (
        select 1 from ${deckCard}
        inner join ${catalogCard} on ${catalogCard.id} = ${deckCard.catalogCardId}
        where ${deckCard.deckId} = ${deck.id}
          and ${catalogCard.name} like ${pattern} escape '\\'
      )`,
    ) as SQL)
  }

  if (options.contains) {
    clauses.push(sql`exists (
      select 1 from ${deckCard}
      where ${deckCard.deckId} = ${deck.id}
        and ${deckCard.catalogCardId} = ${options.contains}
    )`)
  }

  if (options.formatId === 'none') {
    clauses.push(isNull(deck.formatId))
  }
  else if (options.formatId) {
    clauses.push(eq(deck.formatId, options.formatId))
  }

  const where = and(...clauses) as SQL

  const orderBy = options.sort === 'name'
    ? [asc(deck.name)]
    : options.sort === '-name'
      ? [desc(deck.name)]
      : options.sort === 'newest'
        ? [desc(deck.createdAt), asc(deck.name)]
        : [desc(deck.updatedAt), asc(deck.name)]

  // Legality is derived, so `legal=` cannot be a SQL predicate: scan the
  // matching decks (bounded), evaluate them, then paginate in memory.
  const filtersByLegality = options.legal !== undefined

  const candidateRows = filtersByLegality
    ? db.select().from(deck).where(where).orderBy(...orderBy).limit(MAX_LEGALITY_SCAN).all()
    : db.select().from(deck).where(where).orderBy(...orderBy).limit(pageSize).offset((page - 1) * pageSize).all()

  const deckIds = candidateRows.map(row => row.id)
  const cardRows = deckIds.length > 0
    ? db
        .select({
          deckId: deckCard.deckId,
          catalogCardId: deckCard.catalogCardId,
          section: deckCard.section,
          quantity: deckCard.quantity,
        })
        .from(deckCard)
        .where(inArray(deckCard.deckId, deckIds))
        .all()
    : []

  const owned = ownedQuantitiesByCard(db, userId, [...new Set(cardRows.map(row => row.catalogCardId))])

  const formats = ruleFormatsById(db, userId, candidateRows.flatMap(row => (row.formatId ? [row.formatId] : [])))
  const cardData = formats.size > 0
    ? loadCardDataForValidation(db, cardRows.map(row => row.catalogCardId))
    : new Map()

  const entriesByDeck = new Map<string, Array<{ catalogCardId: number, section: DeckSection, quantity: number }>>()
  for (const row of cardRows) {
    const entries = entriesByDeck.get(row.deckId) ?? []
    entries.push({ catalogCardId: row.catalogCardId, section: row.section as DeckSection, quantity: row.quantity })
    entriesByDeck.set(row.deckId, entries)
  }

  const legalityByDeck = new Map<string, boolean>()
  for (const row of candidateRows) {
    const format = row.formatId ? formats.get(row.formatId) : undefined
    if (format) {
      legalityByDeck.set(row.id, evaluateDeck(format.rules, entriesByDeck.get(row.id) ?? [], cardData).legal)
    }
  }

  // A deck without a format is neither legal nor illegal — it drops out of
  // both filters instead of counting as "not legal".
  const matchingRows = filtersByLegality
    ? candidateRows.filter(row => legalityByDeck.get(row.id) === options.legal)
    : candidateRows

  const total = filtersByLegality
    ? matchingRows.length
    : db.select({ count: sql<number>`count(*)` }).from(deck).where(where).get()?.count ?? 0

  const deckRows = filtersByLegality
    ? matchingRows.slice((page - 1) * pageSize, page * pageSize)
    : matchingRows

  const usedByDeck = new Map<string, Map<number, number>>()
  const countsByDeck = new Map<string, { main: number, extra: number, side: number }>()
  for (const row of cardRows) {
    const counts = countsByDeck.get(row.deckId) ?? { main: 0, extra: 0, side: 0 }
    counts[row.section as DeckSection] += row.quantity
    countsByDeck.set(row.deckId, counts)

    const used = usedByDeck.get(row.deckId) ?? new Map<number, number>()
    used.set(row.catalogCardId, (used.get(row.catalogCardId) ?? 0) + row.quantity)
    usedByDeck.set(row.deckId, used)
  }

  // Covers only for the page actually returned, not the whole legality scan.
  const covers = loadDeckCovers(db, deckRows.map(row => row.id))

  const items: DeckListItem[] = deckRows.map((row) => {
    const counts = countsByDeck.get(row.id) ?? { main: 0, extra: 0, side: 0 }
    const used = usedByDeck.get(row.id) ?? new Map<number, number>()

    let missingCount = 0
    for (const [catalogCardId, usedInDeck] of used) {
      missingCount += Math.max(0, usedInDeck - (owned.get(catalogCardId) ?? 0))
    }

    const cardCount = counts.main + counts.extra + counts.side
    const format = row.formatId ? formats.get(row.formatId) : undefined

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      mainCount: counts.main,
      extraCount: counts.extra,
      sideCount: counts.side,
      cardCount,
      // An empty deck has nothing missing, but it is not "complete" either.
      complete: cardCount > 0 && missingCount === 0,
      missingCount,
      formatId: row.formatId,
      formatName: format?.name ?? null,
      legal: format ? legalityByDeck.get(row.id) ?? null : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      visibility: row.visibility,
      cover: covers.get(row.id) ?? null,
    }
  })

  return { items, total, page, pageSize }
}
