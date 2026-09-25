import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError } from 'h3'
import { foldCardName } from '../../shared/card-name-fold'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, catalogCardTranslation, catalogPrinting } from '../db/schema'
import { activeCatalogCard, escapedLike, escapeLikeTerm } from './card-name-search'
import { resolvePasscode } from './card-passcode'

type Db = ReturnType<typeof useDb>

/** Upper bound for a single parsed quantity ("99x Kuriboh" is already absurd). */
export const MAX_ENTRY_QUANTITY = 99
/** Upper bound for how many lines one suggest request may carry. */
export const MAX_ENTRY_LINES = 50
/** Upper bound for a single free-text field (the Liste textarea). */
export const MAX_ENTRY_TEXT_LENGTH = 20_000
/** Candidate rows the name prefilter may return before scoring. */
const CANDIDATE_POOL_LIMIT = 200
/** Fuzzy candidates below this similarity are noise and get dropped. */
const MIN_FUZZY_SCORE = 0.3
const DEFAULT_SUGGEST_LIMIT = 5
const MAX_SUGGEST_LIMIT = 20

// Set codes look like "SDY-006", "LOB-005", "LDS2-EN018", "YS17-EN041".
const SET_CODE_SOURCE = '[A-Z0-9]{2,5}-[A-Z]{0,3}\\d{3}'
const SET_CODE_EXACT = new RegExp(`^${SET_CODE_SOURCE}$`, 'i')
const SET_CODE_PARENTHESIZED = new RegExp(`\\((${SET_CODE_SOURCE})\\)`, 'i')
// YGOPRODeck passcodes are 8 digits (the catalog card id).
const PASSCODE_EXACT = /^\d{8}$/
// A line that is only a quantity ("3", "3x") names no card at all.
const QUANTITY_ONLY = /^\d{1,3}\s*[x×*]?$/i

export type EntryMatchedBy = 'passcode' | 'set_code' | 'exact' | 'prefix' | 'contains' | 'fuzzy'

export interface ParsedEntryLine {
  /** The line exactly as the user/OCR/speech produced it. */
  raw: string
  quantity: number
  /** The searchable remainder (card name, set code, or passcode). */
  query: string
  setCode?: string
  passcode?: number
}

export interface EntryCandidate {
  cardId: number
  name: string
  /** The German card name (ADR 0015), `null` without German data. */
  nameDe: string | null
  type: string
  frameType: string | null
  imageSmall: string | null
  /** 0..1 confidence; 1 for passcode/set code/exact name hits. */
  score: number
  matchedBy: EntryMatchedBy
}

export interface EntrySuggestResult {
  input: ParsedEntryLine
  candidates: EntryCandidate[]
}

/**
 * The shared name folding (`foldCardName`, ADR 0015): lowercase, no accents,
 * `ß` → `ss`, no spaces or punctuation, so "Number 39: Utopia",
 * "number 39 utopia" and "NUMBER39UTOPIA" compare equal and bigram
 * similarity is not dominated by punctuation/whitespace noise. The same
 * form is stored in `name_search`, so the German pool can compare in SQL.
 */
export function normalizeCardName(value: string): string {
  return foldCardName(value)
}

/**
 * Comparison key for scoring. Falls back to a plain lowercased/trimmed form
 * when the folding empties the string (a name of only punctuation), so such
 * input is still compared instead of silently matching nothing.
 */
function fold(value: string): string {
  const normalized = normalizeCardName(value)
  return normalized === '' ? value.trim().toLowerCase() : normalized
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

/**
 * Sørensen–Dice coefficient over character bigrams (0..1). Hand-rolled on
 * purpose: it is a few lines, dependency-free, and tolerant enough for the
 * single-character OCR/speech slips we care about ("Dark Magican",
 * "Blue Eyes White Dragen").
 */
export function similarity(a: string, b: string): number {
  if (a === b) {
    return a.length === 0 ? 0 : 1
  }
  if (a.length < 2 || b.length < 2) {
    return 0
  }

  const left = bigrams(a)
  const right = bigrams(b)
  let shared = 0
  for (const [gram, count] of left) {
    const other = right.get(gram)
    if (other) {
      shared += Math.min(count, other)
    }
  }

  return (2 * shared) / (a.length - 1 + b.length - 1)
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1
  }
  return Math.min(MAX_ENTRY_QUANTITY, Math.floor(value))
}

/**
 * Parses one hand-typed / dictated / OCR'd line into a quantity plus a
 * searchable remainder. Recognized shapes:
 * `3x Dark Magician`, `Dark Magician x3`, `3 Dark Magician`,
 * `Dark Magician (SDY-006)`, `SDY-006`, `46986414`.
 *
 * Purely syntactic: a leading bare number is ambiguous ("7 Colored Fish" is
 * a card, "7 Kuriboh" is a count), so `resolveEntryLine` re-checks the
 * untouched line against the catalog before the line is looked up.
 */
export function parseEntryLine(line: string): ParsedEntryLine {
  const raw = line
  const collapsed = line.replace(/\s+/g, ' ').trim()

  if (QUANTITY_ONLY.test(collapsed)) {
    // "3" / "3x" alone names no card — parseEntryText drops it.
    return { raw, quantity: 1, query: '' }
  }

  // Tabs and commas act as field separators (pasted spreadsheet columns),
  // never as part of a card name.
  let rest = line.replace(/[\t,;]+/g, ' ').replace(/\s+/g, ' ').trim()
  let quantity = 1

  const leadingMultiplier = rest.match(/^(\d{1,3})\s*[x×*]\s*(.+)$/i)
  const trailingMultiplier = rest.match(/^(.+?)\s*[x×*]\s*(\d{1,3})$/i)
  const leadingCount = rest.match(/^(\d{1,3})\s+(.+)$/)

  if (leadingMultiplier) {
    quantity = clampQuantity(Number(leadingMultiplier[1]))
    rest = leadingMultiplier[2]!.trim()
  }
  else if (trailingMultiplier) {
    quantity = clampQuantity(Number(trailingMultiplier[2]))
    rest = trailingMultiplier[1]!.trim()
  }
  else if (leadingCount) {
    quantity = clampQuantity(Number(leadingCount[1]))
    rest = leadingCount[2]!.trim()
  }

  const parsed: ParsedEntryLine = { raw, quantity, query: rest }

  const parenthesized = rest.match(SET_CODE_PARENTHESIZED)
  if (parenthesized) {
    parsed.setCode = parenthesized[1]!.toUpperCase()
    const withoutSetCode = rest.replace(SET_CODE_PARENTHESIZED, ' ').replace(/\s+/g, ' ').trim()
    parsed.query = withoutSetCode === '' ? parsed.setCode : withoutSetCode
    return parsed
  }

  if (SET_CODE_EXACT.test(rest)) {
    parsed.setCode = rest.toUpperCase()
    parsed.query = parsed.setCode
    return parsed
  }

  if (PASSCODE_EXACT.test(rest)) {
    parsed.passcode = Number(rest)
  }

  return parsed
}

/** Parses a multi-line block ("eine Karte pro Zeile"), skipping blank lines. */
export function parseEntryText(text: string): ParsedEntryLine[] {
  return text
    .split(/\r?\n/)
    .map(line => parseEntryLine(line))
    .filter(parsed => parsed.query !== '')
}

interface CandidateRow {
  cardId: number
  name: string
  type: string
  frameType: string | null
}

/**
 * Prefilter query: no joins, no grouping, and only a bounded sort, so a
 * 14k-card catalog scan stays in the single-digit millisecond range. Display
 * data (images, German names) is fetched for the final ranked ids only.
 * Active cards only: quick entry never suggests a retired card (ADR 0019).
 */
function selectCards(db: Db, where: SQL, limit: number, orderBy?: SQL): CandidateRow[] {
  const query = db
    .select({
      cardId: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
    })
    .from(catalogCard)
    .where(and(where, activeCatalogCard()))

  return (orderBy ? query.orderBy(orderBy) : query).limit(limit).all()
}

interface GermanCandidateRow extends CandidateRow {
  /** The folded German name (`catalog_card_translation.name_search`). */
  nameDeSearch: string
}

/**
 * The German pool (ADR 0015): the same whole-query and token patterns as the
 * English prefilter, on the folded `catalog_card_translation.name_search`,
 * ordered by match level and then by the length closest to the query.
 * `foldedQuery` must be non-empty; folded values need no `LIKE` escaping.
 */
function selectGermanCards(db: Db, foldedQuery: string, foldedTokens: string[], limit: number): GermanCandidateRow[] {
  const nameSearch = catalogCardTranslation.nameSearch
  const prefixPattern = `${foldedQuery}%`
  const containsPattern = `%${foldedQuery}%`
  const patterns: SQL[] = [
    sql`${nameSearch} = ${foldedQuery}`,
    sql`${nameSearch} LIKE ${prefixPattern}`,
    sql`${nameSearch} LIKE ${containsPattern}`,
    ...foldedTokens.map(token => sql`${nameSearch} LIKE ${`%${token}%`}`),
  ]

  return db
    .select({
      cardId: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      nameDeSearch: nameSearch,
    })
    .from(catalogCardTranslation)
    .innerJoin(catalogCard, eq(catalogCard.id, catalogCardTranslation.cardId))
    .where(and(eq(catalogCardTranslation.locale, 'de'), activeCatalogCard(), or(...patterns)))
    .orderBy(sql`
      case
        when ${nameSearch} = ${foldedQuery} then 0
        when ${nameSearch} LIKE ${prefixPattern} then 1
        when ${nameSearch} LIKE ${containsPattern} then 2
        else 3
      end, abs(length(${nameSearch}) - ${foldedQuery.length})`)
    .limit(limit)
    .all()
}

function germanNamesByCardId(db: Db, cardIds: number[]): Map<number, string> {
  const byCardId = new Map<number, string>()
  if (cardIds.length === 0) {
    return byCardId
  }

  const rows = db
    .select({ cardId: catalogCardTranslation.cardId, name: catalogCardTranslation.name })
    .from(catalogCardTranslation)
    .where(and(eq(catalogCardTranslation.locale, 'de'), inArray(catalogCardTranslation.cardId, cardIds)))
    .all()

  for (const row of rows) {
    byCardId.set(row.cardId, row.name)
  }

  return byCardId
}

function imagesByCardId(db: Db, cardIds: number[]): Map<number, string | null> {
  const byCardId = new Map<number, string | null>()
  if (cardIds.length === 0) {
    return byCardId
  }

  const rows = db
    .select({
      cardId: catalogCardImage.cardId,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(catalogCardImage)
    .where(inArray(catalogCardImage.cardId, cardIds))
    .groupBy(catalogCardImage.cardId)
    .all()

  for (const row of rows) {
    byCardId.set(row.cardId, row.imageSmall)
  }

  return byCardId
}

function tokenize(query: string): string[] {
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 3)

  return [...new Set(tokens.map(token => token.toLowerCase()))].slice(0, 3)
}

const TIER_RANK: Record<EntryMatchedBy, number> = {
  passcode: 5,
  set_code: 4,
  exact: 3,
  prefix: 2,
  contains: 1,
  fuzzy: 0,
}

interface ScoredCandidate extends CandidateRow {
  score: number
  matchedBy: EntryMatchedBy
}

function betterCandidate(a: ScoredCandidate, b: ScoredCandidate): ScoredCandidate {
  if (TIER_RANK[a.matchedBy] !== TIER_RANK[b.matchedBy]) {
    return TIER_RANK[a.matchedBy] > TIER_RANK[b.matchedBy] ? a : b
  }
  return a.score >= b.score ? a : b
}

function rankCandidates(candidates: ScoredCandidate[], limit: number): ScoredCandidate[] {
  return [...candidates]
    .sort((a, b) => (
      b.score - a.score
      || TIER_RANK[b.matchedBy] - TIER_RANK[a.matchedBy]
      || a.name.length - b.name.length
      || a.name.localeCompare(b.name)
    ))
    .slice(0, limit)
}

function withDisplayData(db: Db, ranked: ScoredCandidate[]): EntryCandidate[] {
  const cardIds = ranked.map(candidate => candidate.cardId)
  const images = imagesByCardId(db, cardIds)
  const germanNames = germanNamesByCardId(db, cardIds)

  return ranked.map(candidate => ({
    cardId: candidate.cardId,
    name: candidate.name,
    nameDe: germanNames.get(candidate.cardId) ?? null,
    type: candidate.type,
    frameType: candidate.frameType,
    imageSmall: images.get(candidate.cardId) ?? null,
    score: Math.round(candidate.score * 1000) / 1000,
    matchedBy: candidate.matchedBy,
  }))
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(MAX_SUGGEST_LIMIT, Math.max(1, limit ?? DEFAULT_SUGGEST_LIMIT))
}

function collectScoredCandidates(db: Db, parsed: ParsedEntryLine, limit: number): Map<number, ScoredCandidate> {
  const byCardId = new Map<number, ScoredCandidate>()

  function remember(candidate: ScoredCandidate) {
    const existing = byCardId.get(candidate.cardId)
    byCardId.set(candidate.cardId, existing ? betterCandidate(existing, candidate) : candidate)
  }

  if (parsed.passcode !== undefined) {
    // The passcode printed on a real card: an alternate artwork resolves to
    // its card (ADR 0023), a renumbered card to its replacement (ADR 0019).
    const passcode = resolvePasscode(db, parsed.passcode)
    if (passcode !== null) {
      for (const row of selectCards(db, eq(catalogCard.id, passcode), 1)) {
        remember({ ...row, score: 1, matchedBy: 'passcode' })
      }
    }
  }

  if (parsed.setCode) {
    const setCode = parsed.setCode.toLowerCase()
    const where = sql`exists (
      select 1 from ${catalogPrinting}
      where ${catalogPrinting.cardId} = ${catalogCard.id}
        and lower(${catalogPrinting.setCode}) = ${setCode}
    )`
    for (const row of selectCards(db, where, limit)) {
      remember({ ...row, score: 1, matchedBy: 'set_code' })
    }
  }

  const query = parsed.query.trim()
  // A bare passcode/set code carries no name information — skip the name
  // search entirely instead of scanning the catalog for "SDY-006".
  const skipNameSearch = query === ''
    || parsed.passcode !== undefined
    || (parsed.setCode !== undefined && SET_CODE_EXACT.test(query))

  if (skipNameSearch) {
    return byCardId
  }

  const foldedQuery = fold(query)
  const lowerQuery = query.toLowerCase()
  const escaped = escapeLikeTerm(query)
  const prefixPattern = `${escaped}%`
  const containsPattern = `%${escaped}%`

  // One scan per line: whole-query patterns plus a few token patterns. The
  // ordering keeps the pool useful rather than arbitrary — whole-query hits
  // first, then the names closest in length to the query, which is what a
  // bigram-similar name looks like. No join and no grouping, so this stays
  // a plain table scan; display data is fetched for the ranked ids only.
  const patterns: SQL[] = [
    sql`lower(${catalogCard.name}) = ${lowerQuery}`,
    escapedLike(catalogCard.name, prefixPattern),
    escapedLike(catalogCard.name, containsPattern),
    ...tokenize(query).map(token => escapedLike(catalogCard.name, `%${escapeLikeTerm(token)}%`)),
  ]

  const pool = selectCards(
    db,
    or(...patterns) as SQL,
    CANDIDATE_POOL_LIMIT,
    sql`
      case
        when lower(${catalogCard.name}) = ${lowerQuery} then 0
        when ${catalogCard.name} LIKE ${prefixPattern} ESCAPE '\\' then 1
        when ${catalogCard.name} LIKE ${containsPattern} ESCAPE '\\' then 2
        else 3
      end, abs(length(${catalogCard.name}) - ${query.length})`,
  )

  for (const row of pool) {
    if (byCardId.has(row.cardId)) {
      continue
    }

    const scored = scoreName(row, foldedQuery, fold(row.name))
    if (scored) {
      remember(scored)
    }
  }

  // The German pool: scored against the German name with the same match
  // levels; `remember` keeps whichever language matched better.
  const germanQuery = normalizeCardName(query)
  if (germanQuery !== '') {
    const germanTokens = [...new Set(tokenize(query).map(normalizeCardName).filter(token => token.length >= 3))]
    for (const row of selectGermanCards(db, germanQuery, germanTokens, CANDIDATE_POOL_LIMIT)) {
      const { nameDeSearch, ...candidate } = row
      const scored = scoreName(candidate, germanQuery, nameDeSearch)
      if (scored) {
        remember(scored)
      }
    }
  }

  return byCardId
}

/** Match level and score of one name (already folded) against the folded query. */
function scoreName(row: CandidateRow, foldedQuery: string, foldedName: string): ScoredCandidate | null {
  const sim = similarity(foldedQuery, foldedName)

  if (foldedName === foldedQuery) {
    return { ...row, score: 1, matchedBy: 'exact' }
  }
  if (foldedName.startsWith(foldedQuery)) {
    return { ...row, score: Math.max(0.8, sim), matchedBy: 'prefix' }
  }
  if (foldedName.includes(foldedQuery)) {
    return { ...row, score: Math.max(0.6, sim), matchedBy: 'contains' }
  }
  if (sim >= MIN_FUZZY_SCORE) {
    return { ...row, score: sim, matchedBy: 'fuzzy' }
  }
  return null
}

/**
 * Ranks catalog cards for one parsed line. Exact identifiers win outright
 * (passcode, set code, exact name); everything else is prefiltered in SQL
 * (whole query first, then per-token LIKE, both bounded) and then scored
 * in memory with a bigram similarity, so misspellings from OCR/speech still
 * surface the right card.
 */
export function suggestCatalogMatches(
  db: Db,
  parsed: ParsedEntryLine,
  options: { limit?: number } = {},
): EntryCandidate[] {
  const limit = normalizeLimit(options.limit)
  const ranked = rankCandidates([...collectScoredCandidates(db, parsed, limit).values()], limit)

  return withDisplayData(db, ranked)
}

/**
 * Re-checks a parsed line against the catalog before it is looked up: when
 * the untouched line is itself a card name ("7 Colored Fish",
 * "30,000-Year White Turtle"), the stripped quantity was a false positive.
 */
export function resolveEntryLine(db: Db, parsed: ParsedEntryLine): ParsedEntryLine {
  const rawLine = parsed.raw.replace(/\s+/g, ' ').trim()
  if (rawLine === '' || (parsed.quantity === 1 && rawLine.toLowerCase() === parsed.query.toLowerCase())) {
    return parsed
  }

  const exact = db
    .select({ id: catalogCard.id })
    .from(catalogCard)
    .where(sql`lower(${catalogCard.name}) = ${rawLine.toLowerCase()}`)
    .limit(1)
    .get()

  // A German card name can start with a number too.
  const foldedLine = normalizeCardName(rawLine)
  const exactGerman = !exact && foldedLine !== ''
    ? db
        .select({ id: catalogCardTranslation.cardId })
        .from(catalogCardTranslation)
        .where(and(eq(catalogCardTranslation.locale, 'de'), eq(catalogCardTranslation.nameSearch, foldedLine)))
        .limit(1)
        .get()
    : undefined

  return exact || exactGerman ? { raw: parsed.raw, quantity: 1, query: rawLine } : parsed
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export interface SuggestRequest {
  lines: ParsedEntryLine[]
  limit: number
}

function countLines(text: string): number {
  return text.split(/\r?\n/).filter(line => line.trim() !== '').length
}

export function parseSuggestLimit(limit: unknown): number {
  if (limit === undefined || limit === null || limit === '') {
    return DEFAULT_SUGGEST_LIMIT
  }
  const value = typeof limit === 'number' ? limit : Number(limit)
  if (!Number.isInteger(value) || value < 1) {
    badRequest('limit must be a positive integer')
  }
  return Math.min(MAX_SUGGEST_LIMIT, value)
}

/**
 * Validates and normalizes the two input modes (Liste textarea, per-item
 * list). Sizes and line counts are checked *before* anything is parsed, so
 * an oversized payload is rejected instead of being tokenized.
 */
export function parseSuggestRequest(body: unknown): SuggestRequest {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const { text, items } = body

  if (text !== undefined && typeof text !== 'string') {
    badRequest('text must be a string')
  }
  if (items !== undefined && !Array.isArray(items)) {
    badRequest('items must be an array of strings')
  }

  if (typeof text === 'string' && text.length > MAX_ENTRY_TEXT_LENGTH) {
    badRequest(`text must be at most ${MAX_ENTRY_TEXT_LENGTH} characters`)
  }

  const lineCount = (typeof text === 'string' ? countLines(text) : 0) + (Array.isArray(items) ? items.length : 0)
  if (lineCount > MAX_ENTRY_LINES) {
    badRequest(`A request may contain at most ${MAX_ENTRY_LINES} lines`)
  }

  const lines: ParsedEntryLine[] = []
  if (typeof text === 'string') {
    lines.push(...parseEntryText(text))
  }
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item !== 'string') {
        badRequest('items must be an array of strings')
      }
      const parsed = parseEntryLine(item)
      if (parsed.query !== '') {
        lines.push(parsed)
      }
    }
  }

  if (lines.length === 0) {
    badRequest('No card lines to look up')
  }

  return { lines, limit: parseSuggestLimit(body.limit) }
}

/** Runs the catalog lookup for a validated request: one result per typed line. */
export function suggestForRequest(db: Db, request: SuggestRequest): EntrySuggestResult[] {
  // Repeated lines ("3x Kuriboh" twice, a pasted list with duplicates) are a
  // common case and each lookup scans the catalog — do it once per query.
  const cache = new Map<string, EntryCandidate[]>()

  return request.lines.map((line) => {
    const input = resolveEntryLine(db, line)
    const cacheKey = `${input.query.toLowerCase()}|${input.setCode ?? ''}|${input.passcode ?? ''}`
    const cached = cache.get(cacheKey)
    const candidates = cached ?? suggestCatalogMatches(db, input, { limit: request.limit })
    if (!cached) {
      cache.set(cacheKey, candidates)
    }

    return { input, candidates }
  })
}
