import { eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { createError } from 'h3'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, catalogPrinting, catalogSet } from '../db/schema'

type Db = ReturnType<typeof useDb>

/** Upper bound for a single parsed quantity ("99x Kuriboh" is already absurd). */
export const MAX_ENTRY_QUANTITY = 99
/** Upper bound for how many lines one suggest request may carry. */
export const MAX_ENTRY_LINES = 200
/** How many candidate rows the SQL prefilter may return before scoring. */
const CANDIDATE_POOL_LIMIT = 200
/** Fuzzy candidates below this similarity are noise and get dropped. */
const MIN_FUZZY_SCORE = 0.3
const DEFAULT_SUGGEST_LIMIT = 5
const MAX_SUGGEST_LIMIT = 20

// Set codes look like "SDY-006", "LOB-005", "LDS2-EN018", "YS17-EN041".
const SET_CODE_SOURCE = '[A-Z0-9]{2,5}-[A-Z]{0,3}\\d{3}'
const SET_CODE_ANYWHERE = new RegExp(SET_CODE_SOURCE, 'gi')
const SET_CODE_EXACT = new RegExp(`^${SET_CODE_SOURCE}$`, 'i')
const SET_CODE_PARENTHESIZED = new RegExp(`\\((${SET_CODE_SOURCE})\\)`, 'i')
// YGOPRODeck passcodes are 8 digits (the catalog card id).
const PASSCODE_EXACT = /^\d{8}$/
const PASSCODE_ANYWHERE = /\b\d{8}\b/g

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

export interface EntryCandidatePrinting {
  id: string
  setCode: string
  setName: string
  rarity: string | null
}

export interface EntryCandidate {
  cardId: number
  name: string
  type: string
  frameType: string | null
  imageSmall: string | null
  /** 0..1 confidence; 1 for passcode/set code/exact name hits. */
  score: number
  matchedBy: EntryMatchedBy
  printings: EntryCandidatePrinting[]
}

export interface EntrySuggestResult {
  input: ParsedEntryLine
  candidates: EntryCandidate[]
}

/**
 * Lowercases and strips everything that is not a letter or digit, so
 * "Number 39: Utopia", "number 39 utopia" and "NUMBER39UTOPIA" compare equal
 * and bigram similarity is not dominated by punctuation/whitespace noise.
 */
export function normalizeCardName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
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
 */
export function parseEntryLine(line: string): ParsedEntryLine {
  const raw = line
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

/**
 * Turns raw OCR output into plausible lookup strings. Set codes and
 * passcodes come first because they identify a card exactly, followed by
 * lines that look like a card name. Lines that are mostly digits or symbols
 * (ATK/DEF rows, copyright footers, card text fragments) are dropped.
 */
export function extractCardCandidatesFromOcrText(text: string): string[] {
  const exact: string[] = []
  const names: string[] = []
  const seen = new Set<string>()

  function push(target: string[], value: string) {
    const key = value.toLowerCase()
    if (value === '' || seen.has(key)) {
      return
    }
    seen.add(key)
    target.push(value)
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (line === '') {
      continue
    }

    for (const match of line.matchAll(SET_CODE_ANYWHERE)) {
      push(exact, match[0].toUpperCase())
    }
    for (const match of line.matchAll(PASSCODE_ANYWHERE)) {
      push(exact, match[0])
    }

    // Drop leading/trailing decoration OCR likes to invent around a title.
    const cleaned = line.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})]+$/u, '').trim()
    if (cleaned.length < 3) {
      continue
    }

    const letters = (cleaned.match(/\p{L}/gu) ?? []).length
    const others = cleaned.replace(/\s/g, '').length - letters
    if (letters < 3 || others > letters) {
      continue
    }

    push(names, cleaned)
  }

  return [...exact, ...names]
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`)
}

function likeCondition(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`
}

interface CandidateRow {
  cardId: number
  name: string
  type: string
  frameType: string | null
  imageSmall: string | null
}

function selectCards(db: Db, where: SQL, limit: number, orderBy?: SQL): CandidateRow[] {
  const query = db
    .select({
      cardId: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(catalogCard)
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(where)
    .groupBy(catalogCard.id)

  return (orderBy ? query.orderBy(orderBy) : query).limit(limit).all()
}

function tokenize(query: string): string[] {
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 3)

  return [...new Set(tokens.map(token => token.toLowerCase()))].slice(0, 5)
}

function printingsByCardId(db: Db, cardIds: number[]): Map<number, EntryCandidatePrinting[]> {
  const byCardId = new Map<number, EntryCandidatePrinting[]>()
  if (cardIds.length === 0) {
    return byCardId
  }

  const rows = db
    .select({
      id: catalogPrinting.id,
      cardId: catalogPrinting.cardId,
      setCode: catalogPrinting.setCode,
      setName: catalogSet.name,
      rarity: catalogPrinting.rarity,
    })
    .from(catalogPrinting)
    .innerJoin(catalogSet, eq(catalogPrinting.setId, catalogSet.id))
    .where(inArray(catalogPrinting.cardId, cardIds))
    .orderBy(catalogPrinting.setCode)
    .all()

  for (const row of rows) {
    const list = byCardId.get(row.cardId) ?? []
    list.push({ id: row.id, setCode: row.setCode, setName: row.setName, rarity: row.rarity })
    byCardId.set(row.cardId, list)
  }

  return byCardId
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

/**
 * Ranks catalog cards for one parsed line. Exact identifiers win outright
 * (passcode, set code, exact name); everything else is prefiltered in SQL
 * (whole query first, then per-token LIKE, capped at CANDIDATE_POOL_LIMIT so
 * a 14k-card catalog stays cheap) and then scored with a bigram similarity
 * so misspellings from OCR/speech still surface the right card.
 */
export function suggestCatalogMatches(
  db: Db,
  parsed: ParsedEntryLine,
  options: { limit?: number } = {},
): EntryCandidate[] {
  const limit = Math.min(MAX_SUGGEST_LIMIT, Math.max(1, options.limit ?? DEFAULT_SUGGEST_LIMIT))
  const byCardId = new Map<number, ScoredCandidate>()

  function remember(candidate: ScoredCandidate) {
    const existing = byCardId.get(candidate.cardId)
    if (!existing || TIER_RANK[candidate.matchedBy] > TIER_RANK[existing.matchedBy]) {
      byCardId.set(candidate.cardId, candidate)
    }
  }

  if (parsed.passcode !== undefined) {
    for (const row of selectCards(db, eq(catalogCard.id, parsed.passcode), 1)) {
      remember({ ...row, score: 1, matchedBy: 'passcode' })
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
  const normalizedQuery = normalizeCardName(query)
  // A bare passcode/set code carries no name information — skip the name
  // search entirely instead of scanning the catalog for "SDY-006".
  const skipNameSearch = normalizedQuery === ''
    || parsed.passcode !== undefined
    || (parsed.setCode !== undefined && SET_CODE_EXACT.test(query))

  if (!skipNameSearch) {
    const escaped = escapeLikeTerm(query)
    const patterns: SQL[] = [
      sql`lower(${catalogCard.name}) = ${query.toLowerCase()}`,
      likeCondition(catalogCard.name, `${escaped}%`),
      likeCondition(catalogCard.name, `%${escaped}%`),
      ...tokenize(query).map(token => likeCondition(catalogCard.name, `%${escapeLikeTerm(token)}%`)),
    ]

    // Whole-query hits must make it into the (capped) pool before the much
    // broader per-token hits, otherwise a common token like "dark" could
    // push the real match out of the candidate window.
    const poolOrder = sql`
      case
        when lower(${catalogCard.name}) = ${query.toLowerCase()} then 0
        when ${catalogCard.name} LIKE ${`${escaped}%`} ESCAPE '\\' then 1
        when ${catalogCard.name} LIKE ${`%${escaped}%`} ESCAPE '\\' then 2
        else 3
      end, length(${catalogCard.name})`

    for (const row of selectCards(db, or(...patterns) as SQL, CANDIDATE_POOL_LIMIT, poolOrder)) {
      if (byCardId.has(row.cardId)) {
        continue
      }

      const normalizedName = normalizeCardName(row.name)
      const sim = similarity(normalizedQuery, normalizedName)

      if (normalizedName === normalizedQuery) {
        remember({ ...row, score: 1, matchedBy: 'exact' })
      }
      else if (normalizedName.startsWith(normalizedQuery)) {
        remember({ ...row, score: Math.max(0.8, sim), matchedBy: 'prefix' })
      }
      else if (normalizedName.includes(normalizedQuery)) {
        remember({ ...row, score: Math.max(0.6, sim), matchedBy: 'contains' })
      }
      else if (sim >= MIN_FUZZY_SCORE) {
        remember({ ...row, score: sim, matchedBy: 'fuzzy' })
      }
    }
  }

  const ranked = [...byCardId.values()]
    .sort((a, b) => (
      b.score - a.score
      || TIER_RANK[b.matchedBy] - TIER_RANK[a.matchedBy]
      || a.name.length - b.name.length
      || a.name.localeCompare(b.name)
    ))
    .slice(0, limit)

  const printings = printingsByCardId(db, ranked.map(candidate => candidate.cardId))

  return ranked.map(candidate => ({
    cardId: candidate.cardId,
    name: candidate.name,
    type: candidate.type,
    frameType: candidate.frameType,
    imageSmall: candidate.imageSmall,
    score: Math.round(candidate.score * 1000) / 1000,
    matchedBy: candidate.matchedBy,
    printings: printings.get(candidate.cardId) ?? [],
  }))
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

export interface EntrySuggestBody {
  text?: unknown
  items?: unknown
  ocrText?: unknown
  limit?: unknown
}

/**
 * Normalizes the three input modes (Liste textarea, per-item list, raw OCR
 * text) into one parsed line list, capped at MAX_ENTRY_LINES.
 */
export function parseSuggestInput(body: unknown): ParsedEntryLine[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    badRequest('Request body must be an object')
  }

  const { text, items, ocrText } = body as EntrySuggestBody
  const lines: ParsedEntryLine[] = []

  if (typeof text === 'string') {
    lines.push(...parseEntryText(text))
  }

  if (items !== undefined) {
    if (!Array.isArray(items)) {
      badRequest('items must be an array of strings')
    }
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

  if (typeof ocrText === 'string') {
    for (const candidate of extractCardCandidatesFromOcrText(ocrText)) {
      const parsed = parseEntryLine(candidate)
      if (parsed.query !== '') {
        lines.push(parsed)
      }
    }
  }

  if (lines.length === 0) {
    badRequest('No card lines to look up')
  }

  return lines.slice(0, MAX_ENTRY_LINES)
}

export function parseSuggestLimit(body: unknown): number {
  const raw = (body as EntrySuggestBody | null | undefined)?.limit
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_SUGGEST_LIMIT
  }
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    badRequest('limit must be a positive integer')
  }
  return Math.min(MAX_SUGGEST_LIMIT, value)
}

/** Runs `suggestCatalogMatches` for every parsed line. */
export function suggestEntryMatches(
  db: Db,
  lines: ParsedEntryLine[],
  limit = DEFAULT_SUGGEST_LIMIT,
): EntrySuggestResult[] {
  return lines.map(input => ({
    input,
    candidates: suggestCatalogMatches(db, input, { limit }),
  }))
}
