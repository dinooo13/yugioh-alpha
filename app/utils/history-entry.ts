import type { LocationQuery, RouteLocationRaw, Router } from 'vue-router'

function sameQuery(a: LocationQuery, b: LocationQuery): boolean {
  const normalize = (query: LocationQuery) => JSON.stringify(
    Object.keys(query)
      .filter(key => query[key] !== undefined)
      .sort()
      .map(key => [key, query[key]]),
  )
  return normalize(a) === normalize(b)
}

/**
 * Whether the previous browser history entry (vue-router keeps it in
 * `history.state.back`) is `target`, compared as a route (path, hash and query,
 * in any key order). A `?card=` overlay the page pushed then closes with
 * `router.back()`, so Back/Forward stay in step with it (#148); anything else
 * (a deep link, a reload, a push from elsewhere, filters changed meanwhile)
 * should drop the param with a replace instead. Always false on the server.
 */
export function isPreviousHistoryEntry(router: Router, target: RouteLocationRaw): boolean {
  if (!import.meta.client) {
    return false
  }
  const back: unknown = window.history.state?.back
  if (typeof back !== 'string') {
    return false
  }
  const previous = router.resolve(back)
  const wanted = router.resolve(target)
  return previous.path === wanted.path && previous.hash === wanted.hash && sameQuery(previous.query, wanted.query)
}
