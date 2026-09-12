// Pure route-classification helper for auth.global.ts (Phase 6 shared views).
// Kept dependency-free (no Nuxt/Vue Router types) so it can be unit-tested
// without a middleware harness.

/** Exact paths that render with or without a session. */
const PUBLIC_EXACT_PATHS = new Set(['/spieler'])
/** Path prefixes (trailing slash required) that render with or without a session. */
const PUBLIC_PREFIXES = ['/spieler/']

/**
 * True for `/spieler` and everything under `/spieler/**` — a shared
 * profile/deck/collection page must be reachable by an anonymous visitor
 * and must not bounce a logged-in one. `/spieler` with no trailing slash
 * (e.g. a trimmed URL) is included so it falls through to the page's own
 * 404, not a login redirect.
 */
export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix))
}
