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
  runtimeConfig: {
    dbFilePath: process.env.DB_FILE_PATH || process.env.DATABASE_URL || './data/app.db',
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-secret-change-me',
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
