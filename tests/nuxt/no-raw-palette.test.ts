import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Gate of the Duel Arena design system (docs/adr/0016-visual-design-system.md):
// components in app/ style themselves with semantic tokens (`text-muted`,
// `bg-elevated`, `border-default`, `text-error`, …) so they work in light and
// dark mode. A raw palette class (`text-gray-500`, `bg-white`,
// `bg-brand-600`, `text-red-600`) or an arbitrary hex color
// (`bg-[#0a0a1a]`) bypasses the theme — use a semantic utility, or a
// building block from app/assets/css/main.css.

const ROOT = process.cwd()
const SCANNED = { dir: 'app', extensions: ['.vue', '.ts'] }

const PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  // The app's own scales are palettes too: use `primary`/`secondary`/`neutral`.
  'brand', 'abyss', 'millennium',
].join('|')
const UTILITIES = 'text|bg|border(?:-[trblxyse])?|ring|ring-offset|divide|outline|from|via|to|fill|stroke|placeholder|decoration|shadow|caret|accent'

const RAW_PALETTE = new RegExp(
  `(?<![\\w/-])(?:[\\w-]+:)*(?:${UTILITIES})-(?:(?:${PALETTES})-\\d{2,3}|white|black)(?:/\\d+)?(?![\\w-])`,
  'g',
)
const ARBITRARY_HEX = /(?<![\w-])(?:[\w-]+:)*[a-z-]+-\[#[\da-f]{3,8}\]/gi

/**
 * Classes that are intentionally raw. Keep this list short, say why for each
 * entry, and drop entries that no longer match (checked below).
 */
const ALLOWLIST: Array<{ file: string, match: string, reason: string }> = [
  ...['emerald', 'sky', 'amber', 'rose', 'teal'].flatMap(color => [
    { file: 'app/utils/avatar.ts', match: `bg-${color}-100`, reason: 'avatar initials: a fixed per-handle color, not a theme role' },
    { file: 'app/utils/avatar.ts', match: `text-${color}-800`, reason: 'avatar initials: a fixed per-handle color, not a theme role' },
    { file: 'app/utils/avatar.ts', match: `dark:bg-${color}-400/15`, reason: 'avatar initials, dark-mode variant of the same hue' },
    { file: 'app/utils/avatar.ts', match: `dark:text-${color}-200`, reason: 'avatar initials, dark-mode variant of the same hue' },
  ]),
  { file: 'app/utils/avatar.ts', match: 'bg-brand-100', reason: 'avatar initials: a fixed per-handle color, not a theme role' },
  { file: 'app/utils/avatar.ts', match: 'text-brand-800', reason: 'avatar initials: a fixed per-handle color, not a theme role' },
  { file: 'app/utils/avatar.ts', match: 'dark:bg-brand-400/15', reason: 'avatar initials, dark-mode variant of the same hue' },
  { file: 'app/utils/avatar.ts', match: 'dark:text-brand-200', reason: 'avatar initials, dark-mode variant of the same hue' },
]

function listFiles(dir: string, extensions: string[]): string[] {
  const entries = readdirSync(resolve(ROOT, dir), { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && extensions.some(extension => entry.name.endsWith(extension)))
    .map(entry => relative(ROOT, join(entry.parentPath, entry.name)))
    .sort()
}

/** Source without `//`, block and HTML comments (they may name old classes). */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

export function rawPaletteClasses(source: string): string[] {
  const code = withoutComments(source)
  return [...code.matchAll(RAW_PALETTE), ...code.matchAll(ARBITRARY_HEX)].map(match => match[0])
}

function findings() {
  return listFiles(SCANNED.dir, SCANNED.extensions).flatMap(file =>
    rawPaletteClasses(readFileSync(resolve(ROOT, file), 'utf8')).map(match => ({ file, match })),
  )
}

describe('no raw palette classes in app/', () => {
  it('matches the classes it should and not the semantic ones', () => {
    expect(rawPaletteClasses('<p class="text-gray-500 hover:bg-white sm:divide-gray-100">')).toEqual(['text-gray-500', 'hover:bg-white', 'sm:divide-gray-100'])
    expect(rawPaletteClasses('<p class="bg-brand-600/20 text-rose-600 bg-[#0a0a1a]">')).toEqual(['bg-brand-600/20', 'text-rose-600', 'bg-[#0a0a1a]'])
    expect(rawPaletteClasses('<p class="text-muted bg-default border-default text-error bg-primary/10 text-inverted ring-secondary/40">')).toEqual([])
    expect(rawPaletteClasses('// was text-gray-500\n<!-- bg-white -->\nconst a = 1')).toEqual([])
    expect(rawPaletteClasses('const url = "https://example.com/text-gray-500"')).toEqual([])
  })

  it('finds none outside the allowlist', () => {
    const offending = findings()
      .filter(({ file, match }) => !ALLOWLIST.some(entry => entry.file === file && entry.match === match))
      .map(({ file, match }) => `${file}: ${match}`)
    expect(offending).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const found = findings()
    const stale = ALLOWLIST
      .filter(entry => !found.some(({ file, match }) => entry.file === file && entry.match === match))
      .map(entry => `${entry.file}: ${entry.match}`)
    expect(stale).toEqual([])
  })
})
