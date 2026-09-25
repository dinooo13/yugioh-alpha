import { isPublicPath } from '~/utils/public-routes'
import { getAuthSession } from '~/utils/session'

const PUBLIC_PAGES = new Set(['/login', '/register'])

// 00.legacy-routes.global.ts MUST run before this middleware (global
// middleware runs in file-name order): isPublicPath only knows the English
// /players/** paths, so an old /spieler/** share link has to be rewritten
// first or an anonymous visitor would be sent to /login.

export default defineNuxtRouteMiddleware(async (to, from) => {
  // While hydrating a server-rendered page, the server already made the auth
  // decision for this document. A second check on the client could disagree
  // (e.g. a session that changed since the HTML was produced) and swap page
  // and layout mid-hydration, which leaves a mismatched DOM (#38, #39).
  // Client-side navigations after hydration are still checked below.
  const nuxtApp = useNuxtApp()
  if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
    return
  }

  // Query/hash-only navigations on the client (filters, `?card=` overlays,
  // #148) stay on a page whose access was already checked when it was
  // entered, so they don't cost a session round-trip. `from.matched` is empty
  // on the app's first navigation (START_LOCATION), which is still checked.
  // A session that expires or is ended in another tab while the user stays
  // on one page is caught by the page's next API call instead: its 401 sends
  // the user to /login (plugins/api-unauthorized.client.ts).
  if (import.meta.client && from.matched.length > 0 && to.path === from.path) {
    return
  }

  // Checked before the session fetch: a shared link must not cost a session
  // round-trip, and a logged-in visitor must NOT be redirected away.
  if (isPublicPath(to.path)) {
    return
  }

  const session = await getAuthSession(
    import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  )

  if (PUBLIC_PAGES.has(to.path)) {
    if (session) {
      const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
      const target = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
      return navigateTo(target)
    }
    return
  }

  if (!session) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
