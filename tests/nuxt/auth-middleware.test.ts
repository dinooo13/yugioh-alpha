import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { START_LOCATION } from 'vue-router'
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

async function runMiddleware(path: string, from: string | RouteLocationNormalized = '/decks') {
  return authMiddleware(route(path), typeof from === 'string' ? route(from) : from)
}

async function withoutHydration(run: () => Promise<void>) {
  const nuxtApp = useNuxtApp()
  const wasHydrating = nuxtApp.isHydrating
  try {
    nuxtApp.isHydrating = false
    await run()
  }
  finally {
    nuxtApp.isHydrating = wasHydrating
  }
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
    await withoutHydration(async () => {
      await runMiddleware('/', '/decks')

      expect(getAuthSession).toHaveBeenCalledTimes(1)
      expect(navigateToMock).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/' } })
    })
  })

  // #148: filters and `?card=` overlays stay on a page whose access was
  // already checked; the page's next 401 catches an ended session instead.
  it('skips the session check on a query-only client navigation', async () => {
    await withoutHydration(async () => {
      expect(await runMiddleware('/inventory?card=1', '/inventory')).toBeUndefined()
      expect(await runMiddleware('/catalog?q=Dark#top', '/catalog?q=Dar')).toBeUndefined()

      expect(getAuthSession).not.toHaveBeenCalled()
      expect(navigateToMock).not.toHaveBeenCalled()
    })
  })

  it('still checks the app\'s first navigation to the same path', async () => {
    await withoutHydration(async () => {
      await runMiddleware('/inventory?card=1', START_LOCATION)

      expect(getAuthSession).toHaveBeenCalledTimes(1)
      expect(navigateToMock).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/inventory?card=1' } })
    })
  })

  it('still checks a path change and redirects without a session', async () => {
    await withoutHydration(async () => {
      await runMiddleware('/decks?q=Dark', '/inventory?q=Dark')

      expect(getAuthSession).toHaveBeenCalledTimes(1)
      expect(navigateToMock).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/decks?q=Dark' } })
    })
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
