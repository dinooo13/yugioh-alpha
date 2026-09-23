// vue-i18n options (ADR 0014). Messages live in i18n/locales/<locale>/*.json
// and are lazy-loaded by @nuxtjs/i18n; this file only holds what JSON can't:
// the fallback and the named number/date formats for `n()` and `d()`.
const dateTime = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
} as const

const date = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
} as const

const integer = {
  maximumFractionDigits: 0,
} as const

export default defineI18nConfig(() => ({
  fallbackLocale: 'de',
  datetimeFormats: {
    de: { dateTime, date },
    en: { dateTime, date },
  },
  numberFormats: {
    de: { integer },
    en: { integer },
  },
}))
