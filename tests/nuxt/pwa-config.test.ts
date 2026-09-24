import { describe, expect, it } from 'vitest'
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
})
