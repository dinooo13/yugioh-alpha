// Classic Plus, step 1: reads the card catalog, applies the mechanical rules
// (1 and 2), picks the cards rules 3–11 might hit with deliberately broad
// keyword patterns, and writes them as batches for the classifier subagent
// (.claude/agents/classic-plus-classifier.md). Cards that already have a
// classification for their current text are skipped.
//
//   node scripts/classic-plus/prefilter.ts [--db path/to/app.db] [--batch-size 50] [--reclassify ids.txt]
//
// --reclassify takes a file with one card id per line; those candidates are
// batched again even if their classification is cached (e.g. after new
// rulings).
//
// Writes (all under scripts/classic-plus/work/, which is not committed):
//   cards.json          every card in the pool, with its rule 1/2 verdict and text hash
//   batches/NNN.jsonl   the cards to classify, one card per line
//
// See docs/adr/0022-classic-plus-format.md.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { CLASSIC_PLUS_FORBIDDEN_FRAME_TYPES, CLASSIC_PLUS_RULE_2_PATTERN } from '../../shared/classic-plus.ts'

const here = dirname(fileURLToPath(import.meta.url))
const workDir = join(here, 'work')
const classificationsPath = join(here, 'classifications.jsonl')

const { values: args } = parseArgs({
  options: {
    'db': { type: 'string', default: process.env.DB_FILE_PATH ?? './data/app.db' },
    'batch-size': { type: 'string', default: '50' },
    'reclassify': { type: 'string' },
  },
})

// Recall over precision: a card none of these match is playable at 3 without
// being classified, so a pattern may only be narrowed with a reason. Most
// patterns look for two things in the same sentence ("both", below).
const SENTENCE_SPLIT = /(?<=\.)\s+|\n|●|•/

function both(first: RegExp, second: RegExp) {
  return (card: CandidateInput) => card.sentences.some(sentence => first.test(sentence) && second.test(sentence))
}

interface CandidateInput {
  desc: string
  sentences: string[]
  isMonster: boolean
  isExtraDeck: boolean
  /** Continuous, Field or Equip Spell/Trap, i.e. a card whose own text can hold a lasting effect. */
  isLastingSpellTrap: boolean
}

const OPPONENT_OR_ALL = /\b(?:opponent|opponent's|neither player|each player|both players|players|monsters|cards|all)\b/i
const REMOVAL = /\b(?:destroy|banish|return|send|shuffle|Tribute|place|attach)\b/i
const MULTIPLE = /\b(?:all|each|up to|as many|any number|two|three|2|3|4|5|equal to|them|those|both)\b/i

const CANDIDATE_PATTERNS: Record<string, (card: CandidateInput) => boolean> = {
  // 3: a lasting restriction on the opponent (or on both players)
  floodgate: card => (card.isLastingSpellTrap && /\b(?:cannot|can't|must|skip|pay|changed? to|only)\b/i.test(card.desc))
    || (card.isMonster && both(OPPONENT_OR_ALL, /\b(?:cannot|can't|must|skip|changed? to|pay \d+ LP|can only)\b|\bno\b[^.]*\bcan\b/i)(card)),
  // 4: a monster effect activated from the hand in the opponent's turn
  handTrap: card => card.isMonster
    && /\b(?:from|in) your hand\b|\bdiscard this card\b|\breveal this card\b/i.test(card.desc)
    && /Quick Effect|opponent's turn|either player's turn|your opponent (?:activates|would|Normal|Special|declares|adds|targets)|opponent's monster declares|damage calculation|battle damage|Battle Phase|When an? (?:opponent|monster)/i.test(card.desc),
  // 5
  draw: card => /\bdraws?\b/i.test(card.desc),
  // 6a / 6b
  damage: card => /\binflicts?\b[^.]*\bdamage\b|\bdamage\b[^.]*\b(?:doubled?|twice)\b|\bdoubles?\b[^.]*\bdamage\b|\bloses? \d+ LP\b|\b(?:LP|Life Points) (?:become|are halved)/i.test(card.desc),
  // 7a
  control: card => /\b(?:take|gain|takes|gains|obtain|switch) control\b|\bcontrol of\b|\bcontrol switch/i.test(card.desc),
  // 7b: back from the GY or banishment onto the field
  revive: both(/\b(?:GY|Graveyard|banished)\b/i, /\bSpecial Summon/i),
  // 7c: Extra Deck summons; 7d: Fusion material from the Deck
  extraDeck: card => both(/\bExtra Deck\b/i, /\bSummon/i)(card) || both(/\bFusion\b/i, /\b(?:from|in) your Deck\b/i)(card),
  // 8 (does not apply to Extra Deck monsters)
  removal: card => !card.isExtraDeck && both(REMOVAL, MULTIPLE)(card),
  // 9
  protection: card => /\b(?:cannot be destroyed|cannot be targeted|unaffected|cannot be the target|cannot target)\b/i.test(card.desc),
  // 10
  negate: card => /\bnegat/i.test(card.desc),
  // 11
  denial: card => /\bskip\b|\bend the (?:Main Phase|Draw Phase|Standby Phase|turn)\b|\bcannot (?:Normal Summon|conduct|draw)\b|\bDraw Phase\b|\bStandby Phase\b/i.test(card.desc),
}

interface CatalogRow {
  id: number
  name: string
  type: string
  frame_type: string | null
  race: string | null
  attribute: string | null
  level: number | null
  atk: number | null
  def: number | null
  desc: string
}

export interface PoolCard {
  id: number
  name: string
  type: string
  frameType: string | null
  race: string | null
  attribute: string | null
  level: number | null
  atk: number | null
  def: number | null
  desc: string
  descHash: string
  /** `1`, `2`, `normal` (no effect text), `candidate`, or `clear` (no pattern matched). */
  route: '1' | '2' | 'normal' | 'candidate' | 'clear'
  patterns: string[]
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function loadCachedHashes(): Map<number, string> {
  const cached = new Map<number, string>()
  if (!existsSync(classificationsPath)) {
    return cached
  }
  for (const line of readFileSync(classificationsPath, 'utf8').split('\n')) {
    if (line.trim()) {
      const entry = JSON.parse(line) as { id: number, descHash: string }
      cached.set(entry.id, entry.descHash)
    }
  }
  return cached
}

function main() {
  const batchSize = Number(args['batch-size'])
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('--batch-size must be a positive integer')
  }
  if (!existsSync(args.db!)) {
    throw new Error(`No database at ${args.db} (pass --db or set DB_FILE_PATH)`)
  }

  const db = new Database(args.db!, { readonly: true, fileMustExist: true })
  const columns = (db.prepare('PRAGMA table_info(catalog_card)').all() as Array<{ name: string }>).map(c => c.name)
  // Retired cards (ADR 0019) are no longer in the catalog's card pool.
  const activeOnly = columns.includes('retired_at') ? 'AND retired_at IS NULL' : ''
  const rows = db.prepare(`
    SELECT id, name, type, frame_type, race, attribute, level, atk, def, desc
    FROM catalog_card
    WHERE COALESCE(frame_type, '') NOT IN ('token', 'skill') ${activeOnly}
    ORDER BY id
  `).all() as CatalogRow[]
  db.close()

  const cached = loadCachedHashes()
  const pool: PoolCard[] = rows.map((row) => {
    const card: PoolCard = {
      id: row.id,
      name: row.name,
      type: row.type,
      frameType: row.frame_type,
      race: row.race,
      attribute: row.attribute,
      level: row.level,
      atk: row.atk,
      def: row.def,
      desc: row.desc,
      descHash: hashText(row.desc),
      route: 'clear',
      patterns: [],
    }
    if (row.frame_type && CLASSIC_PLUS_FORBIDDEN_FRAME_TYPES.includes(row.frame_type)) {
      card.route = '1'
    }
    else if (row.frame_type === 'normal') {
      card.route = 'normal'
    }
    else if (CLASSIC_PLUS_RULE_2_PATTERN.test(row.desc)) {
      card.route = '2'
    }
    else {
      const input: CandidateInput = {
        desc: row.desc,
        sentences: row.desc.split(SENTENCE_SPLIT),
        isMonster: row.type.includes('Monster'),
        isExtraDeck: row.frame_type === 'fusion',
        isLastingSpellTrap: !row.type.includes('Monster') && ['Continuous', 'Field', 'Equip'].includes(row.race ?? ''),
      }
      card.patterns = Object.entries(CANDIDATE_PATTERNS)
        .filter(([, matches]) => matches(input))
        .map(([name]) => name)
      if (card.patterns.length > 0) {
        card.route = 'candidate'
      }
    }
    return card
  })

  const reclassify = new Set(args.reclassify
    ? readFileSync(args.reclassify, 'utf8').split('\n').filter(line => line.trim()).map(Number)
    : [])
  const toClassify = pool.filter(card => card.route === 'candidate'
    && (cached.get(card.id) !== card.descHash || reclassify.has(card.id)))

  rmSync(join(workDir, 'batches'), { recursive: true, force: true })
  mkdirSync(join(workDir, 'batches'), { recursive: true })
  mkdirSync(join(workDir, 'results'), { recursive: true })
  writeFileSync(join(workDir, 'cards.json'), JSON.stringify(pool))

  let batchCount = 0
  for (let start = 0; start < toClassify.length; start += batchSize) {
    batchCount += 1
    const lines = toClassify.slice(start, start + batchSize).map(card => JSON.stringify({
      id: card.id,
      name: card.name,
      type: card.type,
      frameType: card.frameType,
      race: card.race,
      attribute: card.attribute,
      level: card.level,
      desc: card.desc,
    }))
    writeFileSync(join(workDir, 'batches', `${String(batchCount).padStart(3, '0')}.jsonl`), `${lines.join('\n')}\n`)
  }

  const count = (route: PoolCard['route']) => pool.filter(card => card.route === route).length
  console.log(`Card pool: ${pool.length}`)
  console.log(`  rule 1 (frame type):        ${count('1')}`)
  console.log(`  rule 2 (mentions in text):  ${count('2')}`)
  console.log(`  Normal Monsters:            ${count('normal')}`)
  console.log(`  no pattern matched (→ 3):   ${count('clear')}`)
  console.log(`  candidates for rules 3–11:  ${count('candidate')}`)
  console.log(`    already classified:       ${count('candidate') - toClassify.length}`)
  console.log(`    to classify:              ${toClassify.length} in ${batchCount} batches of up to ${batchSize}`)
  for (const name of Object.keys(CANDIDATE_PATTERNS)) {
    console.log(`      ${name.padEnd(12)} ${pool.filter(card => card.patterns.includes(name)).length}`)
  }
}

main()
