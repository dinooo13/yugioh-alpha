// @ts-check
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import withNuxt from './.nuxt/eslint.config.mjs'

const LOCALE_FILES = ['i18n/locales/**/*.json']

// Files whose UI copy has been moved into the i18n catalogues (#34 F2,
// ADR 0014). `no-raw-text` is enforced only here; each F2 PR adds its own
// files, and F2d replaces the list with `app/**/*.vue`.
const EXTRACTED_FILES = [
  // F2a: app shell, auth, profile, dashboard
  'app/app.vue',
  'app/layouts/*.vue',
  'app/components/layout/*.vue',
  'app/components/profile/*.vue',
  'app/pages/index.vue',
  'app/pages/login.vue',
  'app/pages/register.vue',
  'app/pages/profile.vue',
  // F2b: collection side (inventory, quick entry, catalog, wishlist,
  // sharing, player pages except the player deck page)
  'app/components/inventory/*.vue',
  'app/components/entry/*.vue',
  'app/components/collections/*.vue',
  'app/components/card/*.vue',
  'app/components/wishlist/*.vue',
  'app/components/sharing/*.vue',
  'app/pages/inventory/*.vue',
  'app/pages/catalog.vue',
  'app/pages/wishlist.vue',
  'app/pages/players/[[]handle]/index.vue',
  'app/pages/players/[[]handle]/inventory.vue',
  'app/pages/players/[[]handle]/collections/*.vue',
  // F2c: decks, formats, tournaments, the player deck page
  'app/pages/decks/*.vue',
  'app/components/decks/*.vue',
  'app/pages/formats/*.vue',
  'app/components/formats/*.vue',
  'app/pages/tournaments/*.vue',
  'app/components/tournaments/*.vue',
  'app/pages/players/[[]handle]/decks/*.vue',
]

// The plugin's `flat/base` config minus its YAML block (no YAML catalogues)
// and with the JSON parser limited to the catalogues, so package.json,
// migration snapshots etc. are not parsed as message files.
const [pluginSetup, jsonSetup] = vueI18n.configs['flat/base']

export default withNuxt(
  pluginSetup,
  { ...jsonSetup, files: LOCALE_FILES },
  {
    name: 'app/vue-i18n',
    settings: {
      'vue-i18n': {
        localeDir: {
          pattern: './i18n/locales/*/*.json',
          localeKey: 'path',
          localePattern: /^.*\/(?<locale>de|en)\/.*\.json$/,
        },
        messageSyntaxVersion: '^11.0.0',
      },
    },
    rules: {
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/valid-message-syntax': 'error',
      '@intlify/vue-i18n/no-deprecated-i18n-component': 'error',
      '@intlify/vue-i18n/no-deprecated-tc': 'error',
      '@intlify/vue-i18n/no-deprecated-v-t': 'error',
      '@intlify/vue-i18n/no-i18n-t-path-prop': 'error',
      '@intlify/vue-i18n/no-html-messages': 'error',
      '@intlify/vue-i18n/no-v-html': 'error',
      '@intlify/vue-i18n/no-dynamic-keys': 'off',
      '@intlify/vue-i18n/no-unused-keys': 'off',
      '@intlify/vue-i18n/key-format-style': 'off',
    },
  },
  {
    name: 'app/vue-i18n/no-raw-text',
    files: EXTRACTED_FILES,
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', {
        attributes: {
          '/.+/': ['label', 'title', 'placeholder', 'description', 'aria-label', 'alt', 'text', 'help', 'hint'],
        },
        ignorePattern: '^[-–—·…/:()#%+×→•|0-9\\s]+$',
        ignoreText: ['yugioh alpha', 'Y', 'Main', 'Extra', 'Side', 'TCG', 'OCG', 'GOAT', 'ATK', 'DEF'],
      }],
    },
  },
)
