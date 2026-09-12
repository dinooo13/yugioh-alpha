import { getAuthSession } from '~/utils/session'

const PUBLIC_PAGES = new Set(['/login', '/register'])
/** Route prefixes that render with or without a session (Phase 6 shared views). */
const PUBLIC_PREFIXES = ['/spieler/']

export default defineNuxtRouteMiddleware(async (to) => {
  // Checked before the session fetch: a shared link must not cost a session
  // round-trip, and a logged-in visitor must NOT be redirected away.
  if (PUBLIC_PREFIXES.some(prefix => to.path.startsWith(prefix))) {
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
