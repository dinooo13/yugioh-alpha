// The tool layer for the chat assistant (Phase 8, see
// docs/adr/0010-chat-assistant-with-tools.md): every fact the model can pull
// about the user's catalog/inventory/decks, plus the four write tools that
// never mutate directly — they validate their arguments (same
// hand-rolled `validate*Input` style as the rest of the server) and return a
// **pending action** description instead. The chat engine
// (server/utils/assistant-chat.ts) persists that as an `assistantAction` row
// and only `applyAction` below actually calls the existing, already-tested
// write utils (`addOwnedCardsBulkSync`, `createDeck`, `updateDeck`, `upsertDeckCard`),
// re-validating the stored payload and running every write of one action
// inside a single transaction.
//
// Every tool is user-scoped: `run(ctx, args)` only ever touches `ctx.userId`'s
// own rows, and a referenced deck/collection/action that belongs to someone
// else is reported as missing (404), never as forbidden.

import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { assistantAction, catalogCard, catalogCardImage, collection, ownedCard } from '../db/schema'
import type { ToolDefinition } from './deck-assistant-model'
import { cardNameMatches } from './card-name-search'
import { getCatalogCardDetail } from './catalog-search'
import { requireCollectionOwnedByUser, listCollections } from './collections'
import {
  addOwnedCardsBulkSync,
  INVENTORY_BULK_MAX_ITEMS,
  validateInventoryBulkInput,
} from './inventory'
import type { InventoryInput } from './inventory'
import { getAssistantLimits } from './assistant-limits'
import {
  createDeck,
  DECK_NAME_MAX_LENGTH,
  getDeckDetail,
  listDecks,
  updateDeck,
  upsertDeckCard,
  validateDeckCardInput,
  validateDeckCreateCardsInput,
  validateDeckWithRules,
} from './decks'
import type { DeckCardInput, DeckCardRow, DeckDetail, DeckSection } from './decks'
import { isExtraDeckCard, isSectionAllowedForCard } from '../../shared/deck-sections'
import { listRuleFormats, requireAccessibleFormat, requireAssignableFormat } from './rule-formats'
import { loadCardDataForValidation, loadCardNames, maxCopiesByCard, missingCatalogCardIds } from './deck-validation'
import { previewDeckProposal } from './deck-proposal'
import { ACTION_SUMMARY, TOOL_DESCRIPTIONS, TOOL_PARAM_DESCRIPTIONS, TOOL_TEXT } from './assistant-prompts'
import type { AssistantActionKind, AssistantDeckPreview } from '../../shared/assistant-chat'

type Db = ReturnType<typeof useDb>

const GET_CARD_PRINTINGS_MAX = 10
/**
 * Row-scan bound for `search_inventory`'s per-card aggregation (see its
 * query) — a multiple of the configured item cap (`getAssistantLimits()
 * .toolResultItems`), well above what any real collection needs to answer a
 * name/collection-filtered lookup, since the final result is capped to that
 * same item cap anyway. Bounds the worst case (a huge inventory, scanned
 * again on every tool call in a loop).
 */
const SEARCH_INVENTORY_ROW_SCAN_MULTIPLIER = 25

export interface ToolRunContext {
  db: Db
  userId: string
}

export interface AssistantProposedAction {
  kind: AssistantActionKind
  payload: Record<string, unknown>
  summary: string
}

export type ToolOutcome =
  | { result: unknown }
  | { action: AssistantProposedAction, result: unknown }

export interface AssistantTool {
  name: string
  /** Description shown to the model (English, assistant-prompts.ts); the tool name is the wire format. */
  description: string
  parameters: Record<string, unknown>
  kind: 'read' | 'write'
  run: (ctx: ToolRunContext, args: unknown) => Promise<ToolOutcome>
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function notFound(message: string): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) {
    badRequest('Tool arguments must be an object')
  }
  return args
}

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field]
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    badRequest(`${field} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function requireNonEmptyString(args: Record<string, unknown>, field: string): string {
  const value = optionalString(args, field)
  if (value === undefined) {
    badRequest(`${field} is required`)
  }
  return value
}

function requirePositiveInt(args: Record<string, unknown>, field: string): number {
  const value = args[field]
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    badRequest(`${field} must be a positive integer`)
  }
  return numberValue
}

function optionalOffset(args: Record<string, unknown>): number {
  const value = args.offset
  if (value === undefined || value === null || value === '') {
    return 0
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    badRequest('offset must be a non-negative integer')
  }
  return numberValue
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    return fallback
  }
  return Math.min(numberValue, max)
}

function capItems<T>(items: T[], max = getAssistantLimits().toolResultItems): T[] {
  return items.slice(0, max)
}

/**
 * Caps an already fully-materialized array *before* serialization and
 * reports whether it was cut, plus the true total — so the model can say
 * "mindestens N" instead of quietly treating the capped count as complete.
 */
function capResult<T>(items: T[], max = getAssistantLimits().toolResultItems): { items: T[], truncated: boolean, total: number } {
  return { items: items.slice(0, max), truncated: items.length > max, total: items.length }
}

// --- Read tools ----------------------------------------------------------------

function toolSearchCatalog(db: Db, args: unknown) {
  const record = requireArgs(args)
  const query = optionalString(record, 'query') ?? ''
  const itemsCap = getAssistantLimits().toolResultItems
  const limit = clampLimit(record.limit, itemsCap, itemsCap)

  const where = query !== '' ? sqlLikeName(query) : undefined
  // Fetch one row past the limit so we can report `truncated` without a
  // separate COUNT query — the exact total beyond that isn't needed, only
  // whether there is more.
  const rows = db
    .select({
      id: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      archetype: catalogCard.archetype,
    })
    .from(catalogCard)
    .where(where)
    .orderBy(asc(catalogCard.name))
    .limit(limit + 1)
    .all()

  const truncated = rows.length > limit
  const capped = truncated ? rows.slice(0, limit) : rows

  if (capped.length === 0) {
    return { items: [], truncated: false }
  }

  const ids = capped.map(row => row.id)
  const images = db
    .select({ cardId: catalogCardImage.cardId, imageSmall: catalogCardImage.imageUrlSmall })
    .from(catalogCardImage)
    .where(inArray(catalogCardImage.cardId, ids))
    .orderBy(asc(catalogCardImage.cardId), asc(catalogCardImage.id))
    .all()

  const imageByCard = new Map<number, string | null>()
  for (const image of images) {
    if (!imageByCard.has(image.cardId)) {
      imageByCard.set(image.cardId, image.imageSmall)
    }
  }

  return { items: capped.map(row => ({ ...row, imageSmall: imageByCard.get(row.id) ?? null })), truncated }
}

// The same bilingual name search as the catalog (ADR 0015): English or German
// name, a literal substring (wildcards escaped), folded for case and accents.
function sqlLikeName(query: string) {
  return cardNameMatches(query)
}

async function toolGetCard(db: Db, args: unknown) {
  const record = requireArgs(args)
  const id = requirePositiveInt(record, 'id')

  const detail = await getCatalogCardDetail(db, id)
  if (!detail) {
    notFound(TOOL_TEXT.cardNotFound)
  }

  return {
    id: detail.card.id,
    name: detail.card.name,
    type: detail.card.type,
    desc: detail.card.desc,
    attribute: detail.card.attribute,
    race: detail.card.race,
    level: detail.card.level,
    atk: detail.card.atk,
    def: detail.card.def,
    archetype: detail.card.archetype,
    banlistInfo: detail.card.banlistInfo,
    printings: capItems(detail.printings, GET_CARD_PRINTINGS_MAX),
    printingsTruncated: detail.printings.length > GET_CARD_PRINTINGS_MAX,
  }
}

/**
 * The caller's owned cards, aggregated per catalog card, with the card facts
 * a deck-building model needs to pick from them (type, attribute, race,
 * level, ATK/DEF, archetype, Extra Deck or not — no card text; `get_card`
 * has that) and, per card, the copy limit `maxCopies` under `formatId` (3
 * without a format). A card the format forbids is left out entirely, so the
 * model never proposes it from the inventory — ported from the one-shot deck
 * assistant's candidate pool (ADR 0006 → ADR 0011). `offset` pages through a
 * result larger than the item cap.
 */
function toolSearchInventory(db: Db, userId: string, args: unknown) {
  const record = requireArgs(args)
  const query = optionalString(record, 'query')
  const collectionId = optionalString(record, 'collectionId')
  const formatId = optionalString(record, 'formatId')
  const offset = optionalOffset(record)
  if (collectionId) {
    requireCollectionOwnedByUser(db, userId, collectionId)
  }
  const format = formatId ? requireAccessibleFormat(db, userId, formatId) : null

  const clauses = [eq(ownedCard.userId, userId)]
  if (query) {
    clauses.push(sqlLikeName(query))
  }
  if (collectionId) {
    clauses.push(eq(ownedCard.collectionId, collectionId))
  }

  const rows = db
    .select({
      catalogCardId: ownedCard.catalogCardId,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      archetype: catalogCard.archetype,
      quantity: ownedCard.quantity,
      collectionId: ownedCard.collectionId,
      collectionName: collection.name,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .leftJoin(collection, eq(ownedCard.collectionId, collection.id))
    .where(and(...clauses))
    // Ordered so the row-scan bound below (and `offset` paging on top of it)
    // cuts deterministically rather than by insertion order.
    .orderBy(asc(catalogCard.name), asc(ownedCard.id))
    .limit(getAssistantLimits().toolResultItems * SEARCH_INVENTORY_ROW_SCAN_MULTIPLIER)
    .all()

  type Row = typeof rows[number]
  interface Aggregate {
    card: Row
    quantity: number
    collections: Map<string, { id: string, name: string, quantity: number }>
  }

  const byCard = new Map<number, Aggregate>()
  for (const row of rows) {
    const entry = byCard.get(row.catalogCardId) ?? {
      card: row,
      quantity: 0,
      collections: new Map(),
    }
    entry.quantity += row.quantity
    if (row.collectionId) {
      const collectionEntry = entry.collections.get(row.collectionId)
        ?? { id: row.collectionId, name: row.collectionName ?? '', quantity: 0 }
      collectionEntry.quantity += row.quantity
      entry.collections.set(row.collectionId, collectionEntry)
    }
    byCard.set(row.catalogCardId, entry)
  }

  const maxCopies = maxCopiesByCard(db, format?.rules ?? null, [...byCard.keys()])

  const items = [...byCard.values()]
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map(({ card, quantity, collections }) => ({
      catalogCardId: card.catalogCardId,
      name: card.name,
      type: card.type,
      attribute: card.attribute,
      race: card.race,
      level: card.level,
      atk: card.atk,
      def: card.def,
      archetype: card.archetype,
      isExtra: isExtraDeckCard(card),
      quantity,
      maxCopies: maxCopies.get(card.catalogCardId) ?? 0,
      collections: [...collections.values()],
    }))
    .filter(item => item.maxCopies > 0)

  const { toolResultItems } = getAssistantLimits()
  const page = items.slice(offset, offset + toolResultItems)
  return {
    items: page,
    truncated: offset + page.length < items.length,
    total: items.length,
    offset,
    ...(format ? { formatName: format.name } : {}),
  }
}

function toolListCollections(db: Db, userId: string) {
  const { items } = listCollections(db, userId)
  return capResult(items.map(item => ({ id: item.id, name: item.name, cardCount: item.cardCount })))
}

function toolListDecks(db: Db, userId: string, args: unknown) {
  const record = requireArgs(args)
  const query = optionalString(record, 'query')
  const { items, total } = listDecks(db, userId, { q: query, pageSize: getAssistantLimits().toolResultItems })

  const mapped = items.map(item => ({
    id: item.id,
    name: item.name,
    formatName: item.formatName,
    counts: { main: item.mainCount, extra: item.extraCount, side: item.sideCount, total: item.cardCount },
    legal: item.legal,
  }))

  return { items: mapped, truncated: total > mapped.length, total }
}

function deckRowView(row: DeckCardRow, section: DeckSection) {
  return { catalogCardId: row.catalogCardId, name: row.name, section, quantity: row.quantity, owned: row.owned }
}

function toolGetDeck(db: Db, userId: string, args: unknown) {
  const record = requireArgs(args)
  const deckId = requireNonEmptyString(record, 'id')
  const detail = getDeckDetail(db, userId, deckId)

  return {
    id: detail.id,
    name: detail.name,
    formatName: detail.format?.name ?? null,
    counts: detail.counts,
    sections: {
      main: detail.sections.main.map(row => deckRowView(row, 'main')),
      extra: detail.sections.extra.map(row => deckRowView(row, 'extra')),
      side: detail.sections.side.map(row => deckRowView(row, 'side')),
    },
    validation: detail.validation
      ? { legal: detail.validation.legal, issues: detail.validation.issues.map(issue => issue.message) }
      : null,
  }
}

function toolListFormats(db: Db, userId: string) {
  const { items } = listRuleFormats(db, userId)
  return capResult(items.map(item => ({ id: item.id, name: item.name, isBuiltin: item.isBuiltin })))
}

/** Validates the model's `cards` array (a complete planned deck): same per-row rules as `POST /api/decks`, plus known catalog ids and legal sections. */
function parseProposalCards(db: Db, rawCards: unknown): DeckCardInput[] {
  const cards: DeckCardInput[] = validateDeckCreateCardsInput({ cards: rawCards ?? [] }) ?? []
  assertKnownCardsInSections(db, cards)
  return cards
}

/** Validates the model's `changes` array (absolute quantities, 0 removes): same per-row rules as `PUT /api/decks/:id/cards`. */
function parseProposalChanges(db: Db, rawChanges: unknown): DeckCardInput[] {
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    badRequest('changes must be a non-empty array')
  }
  // Matches (and never exceeds) the bulk inventory endpoint's own cap
  // (`INVENTORY_BULK_MAX_ITEMS`, server/utils/inventory.ts) — a deck-cards
  // write is no less bounded than an inventory one.
  if (rawChanges.length > INVENTORY_BULK_MAX_ITEMS) {
    badRequest(`changes must contain at most ${INVENTORY_BULK_MAX_ITEMS} entries`)
  }
  const changes: DeckCardInput[] = rawChanges.map(raw => validateDeckCardInput(raw))
  assertKnownCardsInSections(db, changes)
  return changes
}

function assertKnownCardsInSections(db: Db, cards: DeckCardInput[]) {
  const missingIds = missingCatalogCardIds(db, cards.map(card => card.catalogCardId))
  if (missingIds.length > 0) {
    badRequest(TOOL_TEXT.unknownCardIds(missingIds))
  }
  assertCardsFitSections(db, cards)
}

/**
 * Three shapes. `deckId` alone (optionally with `formatId`) checks a saved
 * deck exactly as before (the rule engine's `DeckValidation`). `cards`
 * checks a planned new deck and `deckId` + `changes` a deck with proposed
 * changes applied — both return the same preview a write tool attaches to
 * its pending action (counts, legality, missing cards), so the model can fix
 * problems *before* proposing anything.
 */
function toolValidateDeck(db: Db, userId: string, args: unknown) {
  const record = requireArgs(args)
  const deckId = optionalString(record, 'deckId')
  const formatId = optionalString(record, 'formatId')
  const hasCards = record.cards !== undefined && record.cards !== null
  const hasChanges = record.changes !== undefined && record.changes !== null

  if (hasCards) {
    if (deckId) {
      badRequest(TOOL_TEXT.cardsWithDeckId)
    }
    return previewForModel(previewDeckProposal(db, userId, { cards: parseProposalCards(db, record.cards), formatId }))
  }
  if (!deckId) {
    badRequest(TOOL_TEXT.deckIdOrCards)
  }
  if (hasChanges) {
    return previewForModel(previewDeckProposal(db, userId, { deckId, changes: parseProposalChanges(db, record.changes), formatId }))
  }

  if (formatId) {
    const format = requireAccessibleFormat(db, userId, formatId)
    return validateDeckWithRules(db, userId, deckId, format.rules)
  }

  const detail = getDeckDetail(db, userId, deckId)
  if (!detail.validation) {
    badRequest(TOOL_TEXT.noFormatAssigned)
  }
  return detail.validation
}

// --- Write tools (propose a pending action; never mutate directly) ------------

/**
 * A preview as the model reads it: the issues as canonical English text only
 * — `issueDetails` (code + params) is for the UI's action card and would just
 * repeat every issue in the tool result.
 */
function previewForModel(preview: AssistantDeckPreview): AssistantDeckPreview {
  if (!preview.validation) {
    return preview
  }
  const { issueDetails: _issueDetails, ...validation } = preview.validation
  return { ...preview, validation }
}

function pendingOutcome(
  kind: AssistantActionKind,
  payload: Record<string, unknown>,
  summary: string,
  extraResult: Record<string, unknown> = {},
): ToolOutcome {
  return {
    action: { kind, payload, summary },
    result: { status: 'pending_confirmation', message: TOOL_TEXT.pending, summary, ...extraResult },
  }
}

/** The proposal's rows plus each card's name — for the action card's table and summary only (see `executeActionPayload`). */
function withCardNames<T extends { catalogCardId: number }>(db: Db, cards: T[]): Array<T & { name: string }> {
  const names = loadCardNames(db, cards.map(card => card.catalogCardId))
  return cards.map(card => ({ ...card, name: names[card.catalogCardId] ?? `#${card.catalogCardId}` }))
}

async function toolAddToInventory(db: Db, userId: string, args: unknown): Promise<ToolOutcome> {
  const record = requireArgs(args)
  const inputs: InventoryInput[] = validateInventoryBulkInput(db, userId, { items: record.items })
  // Each item's `name` is display-only, like the deck tools' rows:
  // `validateInventoryInput` reads only the fields it knows, so it never
  // reaches the write.
  const items = withCardNames(db, inputs)

  const summary = ACTION_SUMMARY.addToInventory(items.length, items.map(item => `${item.name} x${item.quantity}`).join(', '))

  return pendingOutcome('add_to_inventory', { items }, summary)
}

function assertCardsFitSections(db: Db, cards: Array<{ catalogCardId: number, section: DeckSection }>) {
  const cardData = loadCardDataForValidation(db, cards.map(card => card.catalogCardId))
  for (const card of cards) {
    const info = cardData.get(card.catalogCardId)
    if (info && !isSectionAllowedForCard(info, card.section)) {
      badRequest(TOOL_TEXT.sectionNotAllowed(card.catalogCardId, card.section))
    }
  }
}

async function toolCreateDeck(db: Db, userId: string, args: unknown): Promise<ToolOutcome> {
  const record = requireArgs(args)
  const name = requireNonEmptyString(record, 'name')
  if (name.length > DECK_NAME_MAX_LENGTH) {
    badRequest(`name must be at most ${DECK_NAME_MAX_LENGTH} characters`)
  }
  const formatId = optionalString(record, 'formatId')
  if (formatId) {
    requireAssignableFormat(db, userId, formatId)
  }

  const cards = parseProposalCards(db, record.cards)
  const preview = previewDeckProposal(db, userId, { cards, formatId })

  const totalQuantity = cards.reduce((sum, card) => sum + card.quantity, 0)
  const summary = ACTION_SUMMARY.createDeck(name, totalQuantity)

  // `formatName`, the rows' `name` and `preview` are display-only extras for
  // the action card (a snapshot from proposal time) — `executeActionPayload`
  // reads only the keys it needs and re-validates those, so the extras never
  // influence what gets written.
  return pendingOutcome('create_deck', {
    name,
    description: null,
    formatId: formatId ?? null,
    formatName: preview.formatName,
    cards: withCardNames(db, cards),
    preview,
  }, summary, { preview: previewForModel(preview) })
}

async function toolUpdateDeckCards(db: Db, userId: string, args: unknown): Promise<ToolOutcome> {
  const record = requireArgs(args)
  const deckId = requireNonEmptyString(record, 'deckId')
  const detail = getDeckDetail(db, userId, deckId)

  const changes = parseProposalChanges(db, record.changes)
  const preview = previewDeckProposal(db, userId, { deckId, changes })

  const summary = ACTION_SUMMARY.updateDeckCards(changes.length, detail.name)

  // `deckName`, the rows' `name` and `preview` are display-only (see create_deck above).
  return pendingOutcome('update_deck_cards', {
    deckId,
    deckName: detail.name,
    changes: withCardNames(db, changes),
    preview,
  }, summary, { preview: previewForModel(preview) })
}

/** `formatId` for set_deck_format: required key; `''` (or `null`) = remove the format. */
function parseTargetFormatId(record: Record<string, unknown>): string | null {
  if (!('formatId' in record) || record.formatId === undefined) {
    badRequest(TOOL_TEXT.formatIdRequired)
  }
  const value = record.formatId
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    badRequest('formatId must be a string or null')
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function toolSetDeckFormat(db: Db, userId: string, args: unknown): Promise<ToolOutcome> {
  const record = requireArgs(args)
  const deckId = requireNonEmptyString(record, 'deckId')
  const detail = getDeckDetail(db, userId, deckId)

  const formatId = parseTargetFormatId(record)
  // Same check `updateDeck` runs again at apply time.
  const format = formatId ? requireAssignableFormat(db, userId, formatId) : null

  if ((detail.format?.id ?? null) === formatId) {
    badRequest(formatId ? TOOL_TEXT.sameFormat : TOOL_TEXT.alreadyNoFormat)
  }

  const preview = previewDeckProposal(db, userId, { deckId, formatId })

  const summary = ACTION_SUMMARY.setDeckFormat(detail.name, detail.format?.name ?? null, format?.name ?? null)

  // Only `deckId`/`formatId` are ever written; `deckName`, `formatName`,
  // `previousFormat*` and `preview` are display-only (see create_deck above).
  return pendingOutcome('set_deck_format', {
    deckId,
    deckName: detail.name,
    formatId,
    formatName: format?.name ?? null,
    previousFormatId: detail.format?.id ?? null,
    previousFormatName: detail.format?.name ?? null,
    preview,
  }, summary, { preview: previewForModel(preview) })
}

// --- Registry --------------------------------------------------------------------

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: 'search_catalog',
    description: TOOL_DESCRIPTIONS.search_catalog,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.cardNameQuery },
        // The real number is filled in by `toolDefinitions()` below, from
        // `getAssistantLimits()` — this array is built once at module load,
        // so the live (possibly overridden) limit can't be baked in here.
        limit: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.searchCatalogLimit(0) },
      },
    },
    run: async (ctx, args) => ({ result: toolSearchCatalog(ctx.db, args) }),
  },
  {
    name: 'get_card',
    description: TOOL_DESCRIPTIONS.get_card,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.catalogCardId } },
    },
    run: async (ctx, args) => ({ result: await toolGetCard(ctx.db, args) }),
  },
  {
    name: 'search_inventory',
    description: TOOL_DESCRIPTIONS.search_inventory,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.cardNameQuery },
        collectionId: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.collectionId },
        formatId: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.inventoryFormatId },
        offset: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.offset },
      },
    },
    run: async (ctx, args) => ({ result: toolSearchInventory(ctx.db, ctx.userId, args) }),
  },
  {
    name: 'list_collections',
    description: TOOL_DESCRIPTIONS.list_collections,
    kind: 'read',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: async (ctx) => ({ result: toolListCollections(ctx.db, ctx.userId) }),
  },
  {
    name: 'list_decks',
    description: TOOL_DESCRIPTIONS.list_decks,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.deckQuery } },
    },
    run: async (ctx, args) => ({ result: toolListDecks(ctx.db, ctx.userId, args) }),
  },
  {
    name: 'get_deck',
    description: TOOL_DESCRIPTIONS.get_deck,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.deckId } },
    },
    run: async (ctx, args) => ({ result: toolGetDeck(ctx.db, ctx.userId, args) }),
  },
  {
    name: 'list_formats',
    description: TOOL_DESCRIPTIONS.list_formats,
    kind: 'read',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: async (ctx) => ({ result: toolListFormats(ctx.db, ctx.userId) }),
  },
  {
    name: 'validate_deck',
    description: TOOL_DESCRIPTIONS.validate_deck,
    kind: 'read',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        deckId: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.validateDeckId },
        formatId: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.validateFormatId },
        cards: {
          type: 'array',
          description: TOOL_PARAM_DESCRIPTIONS.validateCards,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['catalogCardId', 'section', 'quantity'],
            properties: {
              catalogCardId: { type: 'integer' },
              section: { type: 'string', enum: ['main', 'extra', 'side'] },
              quantity: { type: 'integer' },
            },
          },
        },
        changes: {
          type: 'array',
          description: TOOL_PARAM_DESCRIPTIONS.validateChanges,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['catalogCardId', 'section', 'quantity'],
            properties: {
              catalogCardId: { type: 'integer' },
              section: { type: 'string', enum: ['main', 'extra', 'side'] },
              quantity: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.absoluteQuantity },
            },
          },
        },
      },
    },
    run: async (ctx, args) => ({ result: toolValidateDeck(ctx.db, ctx.userId, args) }),
  },
  {
    name: 'add_to_inventory',
    description: TOOL_DESCRIPTIONS.add_to_inventory,
    kind: 'write',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['catalogCardId', 'quantity'],
            properties: {
              catalogCardId: { type: 'integer' },
              quantity: { type: 'integer' },
              collectionId: { type: 'string' },
              language: { type: 'string' },
              condition: { type: 'string' },
              edition: { type: 'string' },
            },
          },
        },
      },
    },
    run: async (ctx, args) => toolAddToInventory(ctx.db, ctx.userId, args),
  },
  {
    name: 'create_deck',
    description: TOOL_DESCRIPTIONS.create_deck,
    kind: 'write',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string' },
        formatId: { type: 'string' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['catalogCardId', 'section', 'quantity'],
            properties: {
              catalogCardId: { type: 'integer' },
              section: { type: 'string', enum: ['main', 'extra', 'side'] },
              quantity: { type: 'integer' },
            },
          },
        },
      },
    },
    run: async (ctx, args) => toolCreateDeck(ctx.db, ctx.userId, args),
  },
  {
    name: 'update_deck_cards',
    description: TOOL_DESCRIPTIONS.update_deck_cards,
    kind: 'write',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['deckId', 'changes'],
      properties: {
        deckId: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['catalogCardId', 'section', 'quantity'],
            properties: {
              catalogCardId: { type: 'integer' },
              section: { type: 'string', enum: ['main', 'extra', 'side'] },
              quantity: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.absoluteQuantity },
            },
          },
        },
      },
    },
    run: async (ctx, args) => toolUpdateDeckCards(ctx.db, ctx.userId, args),
  },
  {
    name: 'set_deck_format',
    description: TOOL_DESCRIPTIONS.set_deck_format,
    kind: 'write',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['deckId', 'formatId'],
      properties: {
        deckId: { type: 'string' },
        // A plain string, not `['string', 'null']`: the configured
        // OpenAI-compatible provider garbled calls against the union type
        // (empty arguments). The server still accepts null too.
        formatId: { type: 'string', description: TOOL_PARAM_DESCRIPTIONS.setFormatId },
      },
    },
    run: async (ctx, args) => toolSetDeckFormat(ctx.db, ctx.userId, args),
  },
]

/** Patches `search_catalog`'s `limit` param description with the live configured cap — the rest of `ASSISTANT_TOOLS` needs no per-call values. */
function toolParameters(tool: AssistantTool, toolResultItems: number): Record<string, unknown> {
  if (tool.name !== 'search_catalog') {
    return tool.parameters
  }
  const properties = tool.parameters.properties as Record<string, unknown>
  return {
    ...tool.parameters,
    properties: {
      ...properties,
      limit: { type: 'integer', description: TOOL_PARAM_DESCRIPTIONS.searchCatalogLimit(toolResultItems) },
    },
  }
}

export function toolDefinitions(): ToolDefinition[] {
  const { toolResultItems } = getAssistantLimits()
  return ASSISTANT_TOOLS.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: toolParameters(tool, toolResultItems) },
  }))
}

export async function runTool(name: string, ctx: ToolRunContext, rawArgs: unknown): Promise<ToolOutcome> {
  const tool = ASSISTANT_TOOLS.find(candidate => candidate.name === name)
  if (!tool) {
    badRequest(TOOL_TEXT.unknownTool(name))
  }
  return tool.run(ctx, rawArgs)
}

// --- Actions: apply/reject a pending write --------------------------------------

function actionAlreadyResolved(): never {
  throw createError({ statusCode: 409, statusMessage: 'This action was already resolved', data: { code: 'action_already_resolved' } })
}

type AssistantActionRow = typeof assistantAction.$inferSelect

function requireOwnAction(db: Db, userId: string, actionId: string): AssistantActionRow {
  const row = db
    .select()
    .from(assistantAction)
    .where(and(eq(assistantAction.id, actionId), eq(assistantAction.userId, userId)))
    .get()

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Action not found', data: { code: 'action_not_found' } })
  }
  return row
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'statusMessage' in error && typeof (error as { statusMessage?: unknown }).statusMessage === 'string') {
    return (error as { statusMessage: string }).statusMessage
  }
  return 'Unknown error while applying the action'
}

/**
 * Re-validates a pending action's stored payload against the *current* state
 * of the world (deck ownership, catalog card existence, section legality,
 * quantity bounds) before executing it — the payload was validated once when
 * the tool call first proposed it, but time has passed since (cards can be
 * deleted from the catalog, formats removed, decks deleted) and nothing
 * stops a payload row from being anything the `assistant_action` schema
 * allows. Reuses the same validators as the tool layer and the deck/
 * inventory APIs themselves, so this is defense-in-depth, not the only line
 * of defense.
 *
 * Only the keys a write needs are read (`name`/`description`/`formatId`/
 * `cards` for create_deck, `deckId`/`changes` for update_deck_cards,
 * `deckId`/`formatId` for set_deck_format, and per row only
 * `catalogCardId`/`section`/`quantity`); the display-only extras the tools
 * store next to them (`preview`, `formatName`, `deckName`,
 * `previousFormatId`/`previousFormatName`, each row's `name`) are ignored
 * here, so they can never alter a write.
 *
 * Must run synchronously inside the caller's transaction (`applyAction`) —
 * every write util invoked here (`addOwnedCardsBulkSync`, `createDeck`,
 * `updateDeck`, `upsertDeckCard`) is synchronous itself.
 */
function executeActionPayload(db: Db, userId: string, action: AssistantActionRow): unknown {
  switch (action.kind) {
    case 'add_to_inventory': {
      const payload = action.payload as unknown as { items: unknown }
      const inputs = validateInventoryBulkInput(db, userId, { items: payload.items })
      return addOwnedCardsBulkSync(db, userId, inputs)
    }
    case 'create_deck': {
      const payload = action.payload as unknown as {
        name: string
        description: string | null
        formatId: string | null
        cards: unknown
      }
      const cards = validateDeckCreateCardsInput({ cards: payload.cards ?? [] }) ?? []
      const missingIds = missingCatalogCardIds(db, cards.map(card => card.catalogCardId))
      if (missingIds.length > 0) {
        badRequest(TOOL_TEXT.unknownCardIds(missingIds))
      }
      assertCardsFitSections(db, cards)

      // `createDeck` and the optional format assignment both run here, inside
      // the caller's transaction (`applyAction`) — `updateDeck` re-validates
      // the format itself (`requireAssignableFormat`), so a format removed
      // since the action was proposed fails *after* `createDeck` already
      // wrote the deck row; the transaction rolls that back too, leaving no
      // orphan deck.
      const detail = createDeck(db, userId, { name: payload.name, description: payload.description }, cards)
      if (payload.formatId) {
        return updateDeck(db, userId, detail.id, { formatId: payload.formatId })
      }
      return detail
    }
    case 'update_deck_cards': {
      const payload = action.payload as unknown as { deckId: string, changes: unknown }
      const rawChanges = Array.isArray(payload.changes) ? payload.changes : []
      const changes: DeckCardInput[] = rawChanges.map(raw => validateDeckCardInput(raw))
      const missingIds = missingCatalogCardIds(db, changes.map(change => change.catalogCardId))
      if (missingIds.length > 0) {
        badRequest(TOOL_TEXT.unknownCardIds(missingIds))
      }
      assertCardsFitSections(db, changes)

      let detail: DeckDetail | undefined
      for (const change of changes) {
        detail = upsertDeckCard(db, userId, payload.deckId, change)
      }
      return detail
    }
    case 'set_deck_format': {
      const payload = action.payload as { deckId?: unknown, formatId?: unknown }
      if (typeof payload.deckId !== 'string' || payload.deckId === '') {
        badRequest('deckId is required')
      }
      if (payload.formatId !== null && typeof payload.formatId !== 'string') {
        badRequest('formatId must be a string or null')
      }
      // `updateDeck` re-checks deck ownership and (for a string) that the
      // format is still assignable, inside the caller's transaction.
      return updateDeck(db, userId, payload.deckId, { formatId: payload.formatId })
    }
    default:
      throw createError({ statusCode: 500, statusMessage: `Unknown action kind: ${action.kind}` })
  }
}

/**
 * Applies a pending action's payload with the existing, already-tested write
 * utils. Concurrency-safe: the pending → applied transition is claimed with
 * one conditional `UPDATE ... WHERE status = 'pending'` before anything is
 * executed, so two concurrent applies of the same action can never both run
 * it — the loser's `WHERE` matches no row and gets 409. The payload's writes
 * all run inside one transaction, so a failure partway through (a card
 * deleted from the catalog mid-flight, a format removed) leaves no partial
 * deck/inventory changes — only the action's own status moves to `failed`.
 */
export async function applyAction(db: Db, userId: string, actionId: string): Promise<AssistantActionRow> {
  // 404 for a foreign/missing action, independent of its status.
  requireOwnAction(db, userId, actionId)

  const claimed = db
    .update(assistantAction)
    .set({ status: 'applied', resolvedAt: new Date() })
    .where(and(
      eq(assistantAction.id, actionId),
      eq(assistantAction.userId, userId),
      eq(assistantAction.status, 'pending'),
    ))
    .returning()
    .all()

  if (claimed.length === 0) {
    actionAlreadyResolved()
  }
  const action = claimed[0]!

  try {
    const result = db.transaction(tx => executeActionPayload(tx as unknown as Db, userId, action))
    const [updated] = db
      .update(assistantAction)
      .set({ result: result ?? null })
      .where(eq(assistantAction.id, actionId))
      .returning()
      .all()
    return updated!
  }
  catch (error) {
    const [updated] = db
      .update(assistantAction)
      .set({ status: 'failed', result: { error: errorMessage(error) } })
      .where(eq(assistantAction.id, actionId))
      .returning()
      .all()
    return updated!
  }
}

export function rejectAction(db: Db, userId: string, actionId: string): AssistantActionRow {
  const action = requireOwnAction(db, userId, actionId)
  if (action.status !== 'pending') {
    actionAlreadyResolved()
  }

  const [updated] = db
    .update(assistantAction)
    .set({ status: 'rejected', resolvedAt: new Date() })
    .where(eq(assistantAction.id, actionId))
    .returning()
    .all()
  return updated!
}
