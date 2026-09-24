import type { ModuleOptions } from '@vite-pwa/nuxt'

/**
 * Options for `@vite-pwa/nuxt`, kept out of nuxt.config.ts so they can be
 * unit tested (tests/nuxt/pwa-config.test.ts).
 *
 * The service worker must never answer page navigations. Every page is SSR
 * HTML for the current user and session, so a cached copy is wrong for the
 * next visit: it served the logged-out login page for `/` after sign-in and
 * broke hydration (issues #38, #39). Only static build assets are precached.
 */
export const pwaOptions: ModuleOptions = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'yugioh alpha',
    short_name: 'yugioh alpha',
    description: 'Verwaltung für Yu-Gi-Oh!-Sammlungen, Decks, Formate und Turniere',
    lang: 'de',
    display: 'standalone',
    start_url: '/',
    // The dark arena canvas (ADR 0016); app/app.vue switches the page's
    // `theme-color` with the color mode.
    theme_color: '#0a0a1a',
    background_color: '#0a0a1a',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        // Same file: the mark sits inside the 80% safe zone on a full
        // background, so a launcher mask never cuts into it.
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // No HTML: there is no static page to cache, see the note above.
    globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest}'],
    // public/assets holds the local card image set (tens of thousands of
    // files, several GB). It must never end up in the precache manifest.
    globIgnores: ['assets/**'],
    // No navigation fallback, in dev or prod. It must be '' and not null or
    // left out: @vite-pwa/nuxt replaces a missing or null value with '/' in
    // dev (`?? '/'`), and in dev vite-plugin-pwa then precaches `/` and
    // serves it for every visit to `/`. An empty string is kept as is, and
    // workbox skips both the precache entry and the NavigationRoute for it.
    navigateFallback: '',
  },
  devOptions: {
    enabled: true,
    type: 'module',
    suppressWarnings: true,
  },
}
