import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseCompile } from '@intlify/message-compiler'
import type { CompileError } from '@intlify/message-compiler'
import { APP_LOCALES } from '~~/shared/locale'
import type { AppLocale } from '~~/shared/locale'
import { NAMESPACES } from '~~/i18n/namespaces'

// NodeTypes.Plural of @intlify/message-compiler (a const enum, so not
// importable at runtime).
const PLURAL_NODE = 1

type Messages = Record<string, unknown>

function loadNamespace(locale: AppLocale, namespace: string): Messages {
  const file = resolve(process.cwd(), 'i18n/locales', locale, `${namespace}.json`)
  return JSON.parse(readFileSync(file, 'utf8')) as Messages
}

function flatten(messages: Messages, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, leaf] of flatten(value as Messages, path)) {
        out.set(nested, leaf)
      }
    }
    else {
      out.set(path, value)
    }
  }
  return out
}

function compile(message: string): { errors: string[], plural: boolean } {
  const errors: string[] = []
  const { ast } = baseCompile(message, {
    onError: (error: CompileError) => {
      errors.push(error.message)
    },
  })
  return { errors, plural: ast.body.type === PLURAL_NODE }
}

describe.each(NAMESPACES)('i18n catalogue "%s"', (namespace) => {
  const catalogues = Object.fromEntries(APP_LOCALES.map(locale => [locale, loadNamespace(locale, namespace)])) as Record<AppLocale, Messages>
  const flat = Object.fromEntries(APP_LOCALES.map(locale => [locale, flatten(catalogues[locale])])) as Record<AppLocale, Map<string, unknown>>

  it('has exactly one top-level key, the namespace', () => {
    for (const locale of APP_LOCALES) {
      expect(Object.keys(catalogues[locale]), locale).toEqual([namespace])
    }
  })

  it('has the same keys in every locale', () => {
    const [first, ...rest] = APP_LOCALES
    const expected = [...flat[first].keys()].sort()
    for (const locale of rest) {
      expect([...flat[locale].keys()].sort(), `${locale} vs ${first}`).toEqual(expected)
    }
  })

  it('has only non-empty string messages that compile', () => {
    for (const locale of APP_LOCALES) {
      for (const [key, message] of flat[locale]) {
        expect(typeof message, `${locale}:${key}`).toBe('string')
        expect((message as string).trim(), `${locale}:${key}`).not.toBe('')
        expect(compile(message as string).errors, `${locale}:${key}`).toEqual([])
      }
    }
  })

  it('has a plural in every locale when one locale has it', () => {
    for (const key of flat.de.keys()) {
      const plural = APP_LOCALES.map(locale => compile(String(flat[locale].get(key) ?? '')).plural)
      expect(new Set(plural).size, key).toBe(1)
    }
  })
})
