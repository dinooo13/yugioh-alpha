import { isPublicPath } from '~/utils/public-routes'
import { getAuthSession } from '~/utils/session'

const PUBLIC_PAGES = new Set(['/login', '/register'])

export default defineNuxtRouteMiddleware(async (to) => {
  // While hydrating a server-rendered page, the server already made the auth
  // decision for this document. A second check on the client could disagree
  // (e.g. a session that changed since the HTML was produced) and swap page
  // and layout mid-hydration, which leaves a mismatched DOM (#38, #39).
  // Client-side navigations after hydration are still checked below.
  const nuxtApp = useNuxtApp()
  if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
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
