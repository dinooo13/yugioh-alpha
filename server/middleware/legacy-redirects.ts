import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import { legacyRedirectTarget } from '../../shared/legacy-routes'

// Permanent redirects from the German URL scheme
// (docs/adr/0013-english-url-scheme.md). Runs before the Nuxt renderer, so
// auth.global.ts never sees an old path on a page load. /api/**, /_nuxt/**
// etc. pass through: their first segment is not in the legacy table.
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  // h3 v1: `event.path` is the path including `?query` (revisit on Nitro 3).
  const target = legacyRedirectTarget(event.path)
  if (!target) return
  // Old /spieler/** URLs can carry a share token; keep the no-store posture of
  // the former '/spieler/**' route rule on the redirect itself. This also
  // keeps browsers from caching the 301 indefinitely.
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return sendRedirect(event, target, 301)
})
