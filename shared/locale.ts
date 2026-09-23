/**
 * Interface languages (ADR 0014). Pure: shared by the Nitro locale resolver,
 * the app plugin and the profile API. F3 reuses `AppLocale` for the card
 * display language.
 *
 * Adding a language: a new code here, a new `i18n/locales/<code>/` folder and
 * one Nuxt UI locale import in `app/app.vue`.
 */
export const APP_LOCALES = ['de', 'en'] as const

export type AppLocale = typeof APP_LOCALES[number]

export const DEFAULT_APP_LOCALE: AppLocale = 'de'

/** Remembers the interface language for anonymous visitors (and mirrors the profile's). */
export const UI_LOCALE_COOKIE = 'ui_locale'

/**
 * Whether `Accept-Language` takes part in the resolution. Off until the
 * whole UI is translated (#34 F2d), so an English browser doesn't get a
 * half-translated app.
 */
export const DETECT_ACCEPT_LANGUAGE = false

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}

/**
 * The first supported language of an `Accept-Language` header, by quality:
 * only the primary subtag counts (`de-AT` → `de`), `q=0` means "not
 * acceptable", and a missing or garbled header yields `null`.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (typeof header !== 'string' || header.trim() === '') {
    return null
  }

  const ranges: { primary: string, q: number, index: number }[] = []
  header.split(',').forEach((part, index) => {
    const [tag, ...params] = part.trim().split(';')
    const primary = tag?.trim().split('-')[0]?.toLowerCase()
    if (!primary || !/^[a-z]{1,8}$/.test(primary)) {
      return
    }
    let q = 1
    for (const param of params) {
      const [name, value] = param.trim().split('=')
      if (name?.trim().toLowerCase() === 'q') {
        const parsed = Number(value?.trim())
        q = Number.isFinite(parsed) ? parsed : 0
      }
    }
    if (q > 0) {
      ranges.push({ primary, q, index })
    }
  })

  // Stable: equal weights keep the header order.
  ranges.sort((a, b) => b.q - a.q || a.index - b.index)
  const match = ranges.find(range => isAppLocale(range.primary))
  return match ? match.primary as AppLocale : null
}

export interface UiLocaleSources {
  profile?: string | null
  cookie?: string | null
  acceptLanguage?: string | null
}

/** Resolution order: profile → cookie → Accept-Language (if enabled) → `de`. */
export function pickUiLocale(sources: UiLocaleSources, detectHeader = DETECT_ACCEPT_LANGUAGE): AppLocale {
  if (isAppLocale(sources.profile)) {
    return sources.profile
  }
  if (isAppLocale(sources.cookie)) {
    return sources.cookie
  }
  const fromHeader = detectHeader ? localeFromAcceptLanguage(sources.acceptLanguage) : null
  return fromHeader ?? DEFAULT_APP_LOCALE
}
