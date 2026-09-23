/**
 * Message catalogue namespaces (ADR 0014). Each one is a file
 * `i18n/locales/<locale>/<namespace>.json` whose single top-level key is the
 * namespace, so keys read `<namespace>.<section>.<element>`.
 *
 * Imported by nuxt.config.ts (locale file lists) and the catalogue parity
 * test, so a new namespace is added here once.
 */
export const NAMESPACES = [
  'app',
  'common',
  'errors',
  'auth',
  'profile',
  'dashboard',
  'inventory',
  'quickEntry',
  'catalog',
  'collections',
  'wishlist',
  'sharing',
  'players',
  'card',
  'decks',
  'formats',
  'validation',
  'tournaments',
  'assistant',
] as const

export type Namespace = typeof NAMESPACES[number]
