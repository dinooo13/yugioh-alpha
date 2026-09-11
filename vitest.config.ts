import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    include: ['tests/nuxt/**/*.{test,spec}.ts'],
    // Each test file boots its own Nuxt test environment; under full file
    // parallelism that can exceed Vitest's 10s default hook timeout on
    // slower/contended machines. Give `beforeAll` more headroom rather than
    // serializing the whole suite.
    hookTimeout: 30_000,
  },
})
