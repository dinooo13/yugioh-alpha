import { expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

/**
 * Fails when a page test mounted at `route` did not stay on that path —
 * usually the global auth middleware sent it to /login because the file
 * doesn't stub `~/utils/session` (#121). Compares the path only: pages may
 * rewrite their own query on load (e.g. /inventory drops `card`).
 */
export function expectRouteKept(route: string): void {
  const router = useRouter()
  const actual = router.currentRoute.value
  expect(actual.path, `mounted at ${route} but ended at ${actual.fullPath}; stub ~/utils/session so the auth middleware lets the page through`)
    .toBe(router.resolve(route).path)
}

/** `mountSuspended` at `route` + `expectRouteKept(route)`. */
export async function mountAtRoute<T>(component: T, route: string, options: Omit<NonNullable<Parameters<typeof mountSuspended<T>>[1]>, 'route'> = {}) {
  const wrapper = await mountSuspended(component, { ...options, route })
  expectRouteKept(route)
  return wrapper
}
