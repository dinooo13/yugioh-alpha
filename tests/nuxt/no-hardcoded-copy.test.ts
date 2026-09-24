import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Final gate of #34 F2 (ADR 0014): UI copy lives in the i18n catalogues, so
// no string literal in app/ or shared/ may look like German text. Template
// text is covered by ESLint's `no-raw-text`; this scans the string literals
// (script code, template expressions and attribute values), with comments
// stripped. server/ is out of scope — its statusMessages are technical
// English, and the assistant's saved fallback texts are localized on
// purpose (server/utils/assistant-prompts.ts).

const ROOT = process.cwd()
const SCANNED = [
  { dir: 'app', extensions: ['.vue', '.ts'] },
  { dir: 'shared', extensions: ['.ts'] },
]

const GERMAN_LETTERS = /[äöüÄÖÜß]/
const GERMAN_WORDS = /\b(?:der|die|das|und|nicht|kein|keine|mit|für|oder|wird|wurde|bitte|Karte|Karten|Speichern|Abbrechen|Löschen|Zurück)\b/i

/**
 * Literals that look German but are not copy. Keep this list short, say why
 * for each entry, and drop entries that no longer match (checked below).
 *
 * Currently empty: the quick-entry status identifiers
 * (`sicher`/`unsicher`/`ohne_treffer` in app/utils/card-entry.ts, key
 * segments rather than copy) match neither pattern, so they need no entry.
 */
const ALLOWLIST: Array<{ file: string, literal: string, reason: string }> = []

function listFiles(dir: string, extensions: string[]): string[] {
  const entries = readdirSync(resolve(ROOT, dir), { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && extensions.some(extension => entry.name.endsWith(extension)))
    .map(entry => relative(ROOT, join(entry.parentPath, entry.name)))
    .sort()
}

/**
 * The string literals of a JS/TS/Vue source, comments skipped: `'…'`, `"…"`
 * and template literals (their `${…}` parts included — close enough for a
 * copy scan). HTML comments count as comments too.
 */
export function stringLiterals(source: string): string[] {
  const literals: string[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
    }
    else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    }
    else if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      i = end === -1 ? source.length : end + 3
    }
    else if (char === '\'' || char === '"' || char === '`') {
      let j = i + 1
      let value = ''
      while (j < source.length && source[j] !== char) {
        if (source[j] === '\\') {
          value += source[j + 1] ?? ''
          j += 2
          continue
        }
        // A quote in plain JS/HTML never spans lines; bail out on a stray
        // apostrophe (e.g. in template text) instead of eating the file.
        if (char !== '`' && source[j] === '\n') {
          break
        }
        value += source[j]
        j += 1
      }
      if (source[j] === char) {
        literals.push(value)
        i = j + 1
      }
      else {
        i += 1
      }
    }
    else {
      i += 1
    }
  }
  return literals
}

function looksGerman(literal: string): boolean {
  return GERMAN_LETTERS.test(literal) || GERMAN_WORDS.test(literal)
}

describe('no hard-coded UI copy (ADR 0014)', () => {
  it('finds German-looking literals in a sample and ignores comments', () => {
    const sample = [
      '// Die Karte wird gelöscht',
      '/* Abbrechen */',
      '<!-- Zurück -->',
      'const a = \'Karte löschen\'',
      'const b = "ok"',
      'const c = `${n} Karten`',
      'const url = \'https://example.com\' // für später',
    ].join('\n')
    expect(stringLiterals(sample).filter(looksGerman)).toEqual(['Karte löschen', '${n} Karten'])
  })

  it('has no German string literals in app/ and shared/', () => {
    const findings: string[] = []
    const usedAllowlist = new Set<(typeof ALLOWLIST)[number]>()
    let scannedLiterals = 0
    for (const { dir, extensions } of SCANNED) {
      for (const file of listFiles(dir, extensions)) {
        for (const literal of stringLiterals(readFileSync(resolve(ROOT, file), 'utf8'))) {
          scannedLiterals += 1
          if (!looksGerman(literal)) {
            continue
          }
          const allowed = ALLOWLIST.find(entry => entry.file === file && entry.literal === literal)
          if (allowed) {
            usedAllowlist.add(allowed)
          }
          else {
            findings.push(`${file}: ${JSON.stringify(literal)}`)
          }
        }
      }
    }
    // Guards against a scanner that silently stops finding literals.
    expect(scannedLiterals).toBeGreaterThan(1000)
    expect(findings).toEqual([])
    expect(ALLOWLIST.filter(entry => !usedAllowlist.has(entry))).toEqual([])
  })
})
