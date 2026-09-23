import { legacyRedirectTarget } from '~~/shared/legacy-routes'

// Client-side counterpart of server/middleware/legacy-redirects.ts for
// navigations that never hit the server (docs/adr/0013-english-url-scheme.md).
// The `00.` prefix makes it run before auth.global.ts, which would otherwise
// send an anonymous visitor of an old /spieler/** link to /login.
export default defineNuxtRouteMiddleware((to) => {
  const target = legacyRedirectTarget(to.fullPath)
  if (target) return navigateTo(target, { replace: true, redirectCode: 301 })
})
