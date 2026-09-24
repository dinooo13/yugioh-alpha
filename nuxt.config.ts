// https://nuxt.com/docs/api/configuration/nuxt-config
import { NAMESPACES } from './i18n/namespaces'
import { pwaOptions } from './pwa.config'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n', '@vite-pwa/nuxt'],
  // Self-hosted OFL fonts (ADR 0016): bundled from node_modules by Vite, so
  // neither the build nor the browser talks to a font CDN. Nuxt UI's
  // @nuxt/fonts integration is off (`ui.fonts`); it would resolve families
  // through remote providers.
  css: [
    '@fontsource-variable/inter/wght.css',
    '@fontsource-variable/cinzel/wght.css',
    '@fontsource-variable/oxanium/wght.css',
    '~/assets/css/main.css',
  ],
  ui: {
    fonts: false,
  },
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
  // Dark first (ADR 0016). The choice lives in a cookie so the server can
  // render the right `<html class>` and `theme-color` (app/app.vue).
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
    storage: 'cookie',
    storageKey: 'ygo-color-mode',
  },
  routeRules: {
    // The SSR HTML for a shared profile/deck/collection page embeds the same
    // payload as its `/api/**` counterpart (and, for token URLs, the token
    // itself in the URL) — mark it non-cacheable by intermediaries too.
    '/players/**': { headers: { 'cache-control': 'private, no-store' } },
    // Old German paths (/spieler/**, /inventar, /decks/assistent, …) are not
    // route rules: server/middleware/legacy-redirects.ts answers them with a
    // 301 (docs/adr/0013-english-url-scheme.md).
  },
  runtimeConfig: {
    dbFilePath: process.env.DB_FILE_PATH || process.env.DATABASE_URL || './data/app.db',
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-secret-change-me',
    // Set to '1' (via NUXT_E2E_SEED_CATALOG) to upsert the small, deterministic
    // E2E catalog fixture after migrations. Never enabled in normal runs —
    // see server/plugins/migrate.ts and server/db/fixtures/catalog-fixture.ts.
    e2eSeedCatalog: '',
    // Chat assistant (/assistant, incl. deck assistance — ADRs 0010/0011),
    // server-only. See server/utils/deck-assistant-model.ts for how these
    // resolve to a provider. All overridable via NUXT_ASSISTANT_*.
    // Works with any OpenAI-compatible Chat Completions endpoint — OpenAI,
    // OpenRouter, Ollama, LM Studio, OpenCode Zen, etc.
    assistant: {
      // '' (auto: 'openai' when an API key is present or baseUrl was changed
      // from the default, else disabled), 'openai', or 'fake'.
      provider: '',
      baseUrl: 'https://api.openai.com/v1',
      // Falls back to the OPENAI_API_KEY env var when empty. Leave empty for
      // keyless local servers (e.g. Ollama) alongside a custom baseUrl.
      apiKey: '',
      model: 'gpt-4o-mini',
      // Optional `reasoning_effort` (low | medium | high); some gateways such
      // as OpenCode Go require it for certain models. Empty = not sent.
      reasoningEffort: '',
      // Phase 8 chat assistant: model used for any turn that includes an
      // image, when set. Empty = use `model` for those turns too.
      visionModel: '',
      // Phase 8 chat assistant: operational limits, all overridable via
      // NUXT_ASSISTANT_LIMITS_*. See server/utils/assistant-limits.ts
      // (getAssistantLimits) for validation/fallback and .env.example for a
      // documented, commented-out block of these same defaults. Values
      // below double as the defaults `getAssistantLimits()` falls back to
      // when an override is missing or not a sane positive integer.
      limits: {
        maxToolRounds: 24,
        toolResultItems: 100,
        toolResultChars: 60_000,
        historyMessages: 120,
        historyChars: 160_000,
        timeoutMs: 300_000,
      },
    },
    public: {
      betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    },
  },
  app: {
    head: {
      title: 'YGO Alpha',
      // <html lang>, the color-mode class and `theme-color` follow the UI
      // language and color mode: app/app.vue sets them.
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    },
  },
  // UI language (docs/adr/0014-ui-internationalisation.md). The module only
  // loads catalogues and switches vue-i18n; which language a request gets is
  // decided by server/utils/ui-locale.ts (profile → cookie → Accept-Language
  // → de) and applied by app/plugins/ui-locale.ts.
  i18n: {
    // ADR 0013: language-neutral URLs, no locale prefix, no translated slugs.
    strategy: 'no_prefix',
    defaultLocale: 'de',
    detectBrowserLanguage: false,
    // Relative to <rootDir>/i18n.
    langDir: 'locales',
    vueI18n: './i18n.config.ts',
    locales: [
      { code: 'de', language: 'de-DE', name: 'Deutsch', files: NAMESPACES.map(ns => `de/${ns}.json`) },
      { code: 'en', language: 'en-US', name: 'English', files: NAMESPACES.map(ns => `en/${ns}.json`) },
    ],
  },
  // See pwa.config.ts: the service worker only precaches build assets and
  // never answers page navigations (per-user SSR HTML).
  pwa: pwaOptions,
})
