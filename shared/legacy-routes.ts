// German → English URL scheme (docs/adr/0013-english-url-scheme.md). Old URLs
// redirect 301 forever: NEVER remove an entry. Used by
// server/middleware/legacy-redirects.ts (page loads) and
// app/middleware/00.legacy-routes.global.ts (client-side navigations).
// Intentionally dependency-free.

const TOP_LEVEL: Readonly<Record<string, string>> = {
  inventar: 'inventory',
  katalog: 'catalog',
  assistent: 'assistant',
  formate: 'formats',
  wunschliste: 'wishlist',
  turniere: 'tournaments',
  profil: 'profile',
  spieler: 'players',
}
/** Second segment, keyed by the NEW top-level segment. */
const SECOND_LEVEL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  inventory: { erfassen: 'quick-entry' },
  formats: { neu: 'new' },
  tournaments: { neu: 'new' },
}
/** Third segment below /spieler/:handle. */
const PLAYER_SECTIONS: Readonly<Record<string, string>> = {
  inventar: 'inventory',
  sammlungen: 'collections',
}
/** `?view=` values of the inventory page. */
const INVENTORY_VIEWS: Readonly<Record<string, string>> = {
  uebersicht: 'overview',
  liste: 'list',
}

function build(segments: string[], search: string, hash: string): string {
  return `/${segments.join('/')}${search ? `?${search}` : ''}${hash}`
}

/**
 * New URL for a legacy German path (path + optional `?query` + `#hash`), or
 * null when the URL is not a legacy one. Fixed segments match
 * case-insensitively (like Vue Router); dynamic segments (handles, ids) and
 * the query are copied verbatim, except for the few renamed query values.
 * The result always starts with a fixed English segment and never maps
 * again, so every old URL is exactly one hop away from its new one.
 */
export function legacyRedirectTarget(url: string): string | null {
  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const rest = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = rest.indexOf('?')
  const path = queryAt === -1 ? rest : rest.slice(0, queryAt)
  let search = queryAt === -1 ? '' : rest.slice(queryAt + 1)

  const segments = path.split('/').filter(Boolean) // also drops a trailing slash / "//"
  const first = segments[0]?.toLowerCase()
  if (!first) return null

  if (first === 'decks') {
    // Former one-shot builder (ADR 0011): straight to the assistant, no chain
    // (ADR 0021: no deck entry point, so plain `/assistant`).
    if (segments.length === 2 && segments[1]!.toLowerCase() === 'assistent') {
      return build(['assistant'], search, hash)
    }
    // Dashboard "Deck anlegen" used `/decks?neu=1`.
    if (segments.length === 1 && search) {
      const params = new URLSearchParams(search)
      if (!params.has('neu')) return null
      const value = params.get('neu')!
      params.delete('neu')
      if (!params.has('new')) params.set('new', value)
      return build(['decks'], params.toString(), hash)
    }
    return null
  }

  const top = TOP_LEVEL[first]
  if (!top) return null
  const next = [top, ...segments.slice(1)]
  if (next[1] !== undefined) next[1] = SECOND_LEVEL[top]?.[next[1].toLowerCase()] ?? next[1]
  if (top === 'players' && next[2] !== undefined) next[2] = PLAYER_SECTIONS[next[2].toLowerCase()] ?? next[2]

  if (top === 'inventory' && segments.length === 1 && search) {
    const params = new URLSearchParams(search)
    const view = params.get('view')
    if (view && INVENTORY_VIEWS[view]) {
      params.set('view', INVENTORY_VIEWS[view])
      search = params.toString()
    }
  }
  return build(next, search, hash)
}
