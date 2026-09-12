// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
  },
  nitro: {
    // Enables server/tasks/** (used by the catalog:sync task).
    // https://nitro.build/guide/tasks
    experimental: {
      tasks: true,
    },
  },
  colorMode: {
    preference: 'light',
  },
  routeRules: {
    // The SSR HTML for a shared profile/deck/collection page embeds the same
    // payload as its `/api/**` counterpart (and, for token URLs, the token
    // itself in the URL) — mark it non-cacheable by intermediaries too.
    '/spieler/**': { headers: { 'cache-control': 'private, no-store' } },
  },
  runtimeConfig: {
    dbFilePath: process.env.DB_FILE_PATH || process.env.DATABASE_URL || './data/app.db',
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-secret-change-me',
    // Set to '1' (via NUXT_E2E_SEED_CATALOG) to upsert the small, deterministic
    // E2E catalog fixture after migrations. Never enabled in normal runs —
    // see server/plugins/migrate.ts and server/db/fixtures/catalog-fixture.ts.
    e2eSeedCatalog: '',
    // AI deck assistant (Phase 5), server-only. See server/utils/deck-assistant-model.ts
    // for how these resolve to a provider. All overridable via NUXT_ASSISTANT_*.
    assistant: {
      // '' (auto: 'anthropic' when an API key is present, else disabled), 'anthropic', or 'fake'.
      provider: '',
      // Falls back to the SDK's own ANTHROPIC_API_KEY env var when empty.
      apiKey: '',
      model: 'claude-opus-5',
      // 'low' | 'medium' | 'high' | 'xhigh' | 'max'.
      effort: 'high',
    },
    public: {
      betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    },
  },
  app: {
    head: {
      title: 'yugioh alpha',
      htmlAttrs: { lang: 'de' },
      meta: [{ name: 'theme-color', content: '#6D5DF6' }],
    },
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'yugioh alpha',
      short_name: 'yugioh alpha',
      description: 'Verwaltung für Yu-Gi-Oh!-Sammlungen, Decks, Formate und Turniere',
      lang: 'de',
      display: 'standalone',
      start_url: '/',
      theme_color: '#6D5DF6',
      background_color: '#ffffff',
      icons: [
        {
          src: '/icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    },
    devOptions: {
      enabled: true,
      type: 'module',
      suppressWarnings: true,
    },
  },
})
