import { isPublicPath } from '~/utils/public-routes'

// Global 401 handling (#148): an API call that fails with 401 on a protected
// page means the session ended (expired, or signed out in another tab) while
// the user stayed on the page. The user goes to /login and comes back after
// signing in. See plugins/api-unauthorized.client.ts.

/** Pages that decide about sessions themselves: never redirected from. */
const AUTH_PAGES = new Set(['/login', '/register'])

/** Whether a failed request is one of the app's own APIs (not better-auth's `/api/auth/**`). */
export function isProtectedApiRequest(request: RequestInfo | URL, origin: string): boolean {
  const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
  let url: URL
  try {
    url = new URL(raw, origin)
  }
  catch {
    return false
  }
  return url.origin === origin
    && url.pathname.startsWith('/api/')
    && !url.pathname.startsWith('/api/auth/')
}

/** Whether a 401 on this page sends the user to /login (not on the auth and shared pages). */
export function redirectsOnUnauthorized(path: string): boolean {
  return !AUTH_PAGES.has(path) && !isPublicPath(path)
}

export interface UnauthorizedHandlerOptions {
  /** The current route. */
  currentRoute: () => { path: string, fullPath: string }
  /** Whether a session still exists (a 401 despite one is not a sign-out). */
  hasSession: () => Promise<boolean>
  redirect: (target: { path: string, query: { redirect: string } }) => unknown
}

/**
 * Handles 401s from the app's APIs: once per burst (parallel calls that all
 * fail count once), only on protected pages, and only when the session is
 * really gone. The last check also keeps it from looping with the auth
 * middleware, which sends a signed-in visitor away from /login.
 */
export function createUnauthorizedHandler(options: UnauthorizedHandlerOptions) {
  let running = false
  return async function onUnauthorized(): Promise<void> {
    if (running || !redirectsOnUnauthorized(options.currentRoute().path)) {
      return
    }
    running = true
    try {
      if (await options.hasSession()) {
        return
      }
      // The user may have moved on while the session was checked.
      const route = options.currentRoute()
      if (!redirectsOnUnauthorized(route.path)) {
        return
      }
      await options.redirect({ path: '/login', query: { redirect: route.fullPath } })
    }
    finally {
      running = false
    }
  }
}
