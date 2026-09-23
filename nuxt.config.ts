// https://nuxt.com/docs/api/configuration/nuxt-config
import { pwaOptions } from './pwa.config'

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
      title: 'yugioh alpha',
      htmlAttrs: { lang: 'de' },
      meta: [{ name: 'theme-color', content: '#6D5DF6' }],
    },
  },
  // See pwa.config.ts: the service worker only precaches build assets and
  // never answers page navigations (per-user SSR HTML).
  pwa: pwaOptions,
})
