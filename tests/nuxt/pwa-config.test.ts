import { afterEach, describe, expect, it, vi } from 'vitest'
import { pwaOptions } from '../../pwa.config'

// Pages are per-user SSR HTML, so the service worker must never answer a
// navigation. A cached `/` served the login page after sign-in (#38, #39).
describe('PWA service worker options', () => {
  it('disables the navigation fallback with an empty string, not null', () => {
    // @vite-pwa/nuxt turns a missing or null navigateFallback into '/' in
    // dev (`?? '/'`), which precaches `/` and serves it for every visit.
    // Only a non-nullish, falsy value keeps both the precache entry and
    // workbox's NavigationRoute out of the generated sw.js.
    expect(pwaOptions.workbox).toHaveProperty('navigateFallback', '')
  })

  it('does not precache any HTML', () => {
    const patterns = pwaOptions.workbox?.globPatterns ?? []

    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) {
      expect(pattern).not.toMatch(/html/i)
    }
  })

  it('keeps the local card image set (public/assets) out of the precache', () => {
    expect(pwaOptions.workbox?.globIgnores).toContain('assets/**')
  })

  it('does not precache web fonts (they load on demand per unicode range)', () => {
    for (const pattern of pwaOptions.workbox?.globPatterns ?? []) {
      expect(pattern).not.toMatch(/woff/i)
    }
  })
})

describe('PWA manifest', () => {
  it('is named "YGO Alpha" and describes the game without claiming its name (ADR 0018)', () => {
    const manifest = pwaOptions.manifest || {}
    expect(manifest.name).toBe('YGO Alpha')
    expect(manifest.short_name).toBe('YGO Alpha')
    expect(manifest.description).toContain('Inoffizielles Fan-Tool')
  })

  it('uses the dark arena canvas for the splash and title bar', () => {
    const manifest = pwaOptions.manifest || {}
    expect(manifest.theme_color).toBe('#0a0a1a')
    expect(manifest.background_color).toBe('#0a0a1a')
  })

  it('offers the icon as a maskable icon too', () => {
    const manifest = pwaOptions.manifest || {}
    const purposes = (manifest.icons ?? []).map(icon => icon.purpose)
    expect(purposes).toContain('any')
    expect(purposes).toContain('maskable')
  })

  it('offers PNG icons for launchers without SVG support', () => {
    const manifest = pwaOptions.manifest || {}
    const pngSizes = (manifest.icons ?? []).filter(icon => icon.type === 'image/png').map(icon => icon.sizes)
    expect(pngSizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  })
})

// The dev service worker broke the dev server after every .nuxt wipe (#94);
// it is opt-in with PWA_DEV_SW=1.
describe('PWA dev service worker', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is off in dev without PWA_DEV_SW', async () => {
    vi.stubEnv('PWA_DEV_SW', undefined)
    vi.resetModules()
    const { pwaOptions: options } = await import('../../pwa.config')
    expect(options.devOptions?.enabled).toBe(false)
  })

  it('is on with PWA_DEV_SW=1', async () => {
    vi.stubEnv('PWA_DEV_SW', '1')
    vi.resetModules()
    const { pwaOptions: options } = await import('../../pwa.config')
    expect(options.devOptions?.enabled).toBe(true)
  })
})
