import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { RouteLocationNormalized } from 'vue-router'
import legacyRoutesMiddleware from '~/middleware/00.legacy-routes.global'
import authMiddleware from '~/middleware/auth.global'
// Untyped virtual module (declared in .nuxt/types/build.d.ts): the global
// middleware list the router plugin runs, in order.
import { globalMiddleware } from '#build/middleware.mjs'

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn((target: unknown) => target),
}))

mockNuxtImport('navigateTo', () => navigateToMock)

function route(path: string): RouteLocationNormalized {
  return useRouter().resolve(path) as RouteLocationNormalized
}

function runMiddleware(path: string) {
  return legacyRoutesMiddleware(route(path), route('/'))
}

// Client-side half of the German → English redirects
// (docs/adr/0013-english-url-scheme.md); the mapping itself is covered by
// legacy-routes.test.ts.
describe('legacy routes middleware', () => {
  beforeEach(() => {
    navigateToMock.mockClear()
  })

  it('replaces an old path with its English one (301 on the server)', () => {
    runMiddleware('/spieler/dino/sammlungen/abc?token=Xy-_z')

    expect(navigateToMock).toHaveBeenCalledWith(
      '/players/dino/collections/abc?token=Xy-_z',
      { replace: true, redirectCode: 301 },
    )
  })

  it('sends /decks/assistent straight to the chat', () => {
    runMiddleware('/decks/assistent')

    expect(navigateToMock).toHaveBeenCalledWith(
      '/assistant?intent=new-deck',
      { replace: true, redirectCode: 301 },
    )
  })

  it('leaves English paths alone', () => {
    expect(runMiddleware('/players/dino')).toBeUndefined()
    expect(runMiddleware('/inventory?view=overview')).toBeUndefined()
    expect(runMiddleware('/decks/abc')).toBeUndefined()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('runs before auth.global so old share links skip the login check', () => {
    // Nuxt runs global middleware in file-name order; `00.` keeps it first.
    const global: unknown[] = globalMiddleware
    const legacyAt = global.indexOf(legacyRoutesMiddleware)
    const authAt = global.indexOf(authMiddleware)
    expect(legacyAt).toBeGreaterThanOrEqual(0)
    expect(authAt).toBeGreaterThan(legacyAt)
  })
})
