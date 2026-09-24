// @ts-check
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import withNuxt from './.nuxt/eslint.config.mjs'

const LOCALE_FILES = ['i18n/locales/**/*.json']

// Every Vue file takes its UI copy from the i18n catalogues (#34 F2,
// ADR 0014); `no-raw-text` keeps it that way. (F2a–F2c ratcheted this file by
// file; F2d made it cover all of app/.)
const VUE_FILES = ['app/**/*.vue']

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
    files: VUE_FILES,
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', {
        attributes: {
          '/.+/': ['label', 'title', 'placeholder', 'description', 'aria-label', 'alt', 'text', 'help', 'hint'],
        },
        // `*`, not `+`: an empty `alt=""` (a decorative image) is not copy.
        ignorePattern: '^[-–—·…/:()#%+×→•|0-9\\s]*$',
        ignoreText: ['yugioh alpha', 'yugioh', 'alpha', 'Y', 'Main', 'Extra', 'Side', 'TCG', 'OCG', 'GOAT', 'ATK', 'DEF'],
      }],
    },
  },
  {
    // Counted phrases go through `useCount()` (vue-i18n plurals, localized
    // numbers) — `pluralize` builds German-only strings.
    name: 'app/no-german-plural',
    files: ['app/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        // Matches `~~/shared/plural` as well as relative paths.
        patterns: [{ group: ['**/shared/plural'], message: 'Use useCount() from app/composables/useCount.ts (ADR 0014).' }],
      }],
    },
  },
)
