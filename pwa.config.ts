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
    name: 'YGO Alpha',
    short_name: 'YGO Alpha',
    description: 'Inoffizielles Fan-Tool für Sammlung, Decks, Formate und Turniere im Yu-Gi-Oh!-Sammelkartenspiel',
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
      // PNGs for launchers and install prompts that don't take SVG.
      {
        src: '/pwa-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Full-bleed background with the mark inside the 80% safe zone, so a
        // launcher mask never cuts into it or shows transparent corners.
        src: '/pwa-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
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
    // Off by default in dev (#94): vite-plugin-pwa remembers "dev SW generated" across Nuxt's
    // in-process restarts, but .nuxt/dev-sw-dist is gone once `nuxt prepare`/`nuxt build` (also
    // run by `pnpm install`) wiped .nuxt, so the next request for the dev SW failed with ENOENT
    // and a Vite error overlay. The dev SW was also behind #38/#39. Set PWA_DEV_SW=1 to test PWA
    // behaviour in dev (then restart the dev server by hand after such a wipe).
    enabled: process.env.PWA_DEV_SW === '1',
    type: 'module',
    suppressWarnings: true,
  },
}
