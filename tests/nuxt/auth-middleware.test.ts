import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { RouteLocationNormalized } from 'vue-router'
import authMiddleware from '~/middleware/auth.global'
import { getAuthSession } from '~/utils/session'

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn((target: unknown) => target),
}))

mockNuxtImport('navigateTo', () => navigateToMock)

vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(async () => null),
}))

function route(path: string): RouteLocationNormalized {
  return useRouter().resolve(path) as RouteLocationNormalized
}

async function runMiddleware(path: string) {
  return authMiddleware(route(path), route('/'))
}

describe('auth route middleware', () => {
  beforeEach(() => {
    // The test environment's own startup navigation already ran this global
    // middleware; only count calls made by the test itself.
    vi.mocked(getAuthSession).mockClear()
    navigateToMock.mockClear()
  })

  it('keeps the server decision while hydrating a server-rendered page', async () => {
    const nuxtApp = useNuxtApp()
    const wasHydrating = nuxtApp.isHydrating
    const wasServerRendered = nuxtApp.payload.serverRendered
    try {
      nuxtApp.isHydrating = true
      nuxtApp.payload.serverRendered = true

      expect(await runMiddleware('/')).toBeUndefined()
      expect(getAuthSession).not.toHaveBeenCalled()
      expect(navigateToMock).not.toHaveBeenCalled()
    }
    finally {
      nuxtApp.isHydrating = wasHydrating
      nuxtApp.payload.serverRendered = wasServerRendered
    }
  })

  it('still redirects to /login on a client navigation without a session', async () => {
    const nuxtApp = useNuxtApp()
    const wasHydrating = nuxtApp.isHydrating
    try {
      nuxtApp.isHydrating = false

      await runMiddleware('/')

      expect(getAuthSession).toHaveBeenCalledTimes(1)
      expect(navigateToMock).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/' } })
    }
    finally {
      nuxtApp.isHydrating = wasHydrating
    }
  })

  it('checks the session during hydration when the page was not server-rendered', async () => {
    const nuxtApp = useNuxtApp()
    const wasHydrating = nuxtApp.isHydrating
    const wasServerRendered = nuxtApp.payload.serverRendered
    try {
      nuxtApp.isHydrating = true
      nuxtApp.payload.serverRendered = false

      await runMiddleware('/inventory')

      expect(getAuthSession).toHaveBeenCalledTimes(1)
      expect(navigateToMock).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/inventory' } })
    }
    finally {
      nuxtApp.isHydrating = wasHydrating
      nuxtApp.payload.serverRendered = wasServerRendered
    }
  })
})
