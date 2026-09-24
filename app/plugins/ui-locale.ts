import { DEFAULT_APP_LOCALE, isAppLocale, UI_LOCALE_COOKIE } from '~~/shared/locale'
import type { Composer } from 'vue-i18n'
import type { AppLocale } from '~~/shared/locale'
import { CARD_LOCALE_CHOICE_STATE, uiLocaleCookieOptions } from '~/utils/ui-locale'

/**
 * Applies the request's UI language (ADR 0014). The server decides it
 * (profile → `ui_locale` cookie → Accept-Language → de, see
 * server/utils/ui-locale.ts) and SSR renders in it; the choice travels to the
 * client in `useState`, so hydration switches to the same language before
 * the first render — no flash, no mismatch.
 *
 * The card language choice (ADR 0015) travels the same way: the profile's
 * `card_locale` goes into `useState` during SSR (`null` = follow the
 * interface language), so the first render already shows the right card
 * names and hydration matches.
 *
 * Runs after the module's own plugins, whose detection is off
 * (`detectBrowserLanguage: false`), so this is the only place that picks
 * the initial language.
 */
export default defineNuxtPlugin({
  name: 'ui-locale',
  dependsOn: ['i18n:plugin', 'i18n:plugin:route-locale-detect'],
  async setup(nuxtApp) {
    const state = useState<AppLocale | null>('ui-locale', () => null)
    const cardLocaleChoice = useState<AppLocale | null>(CARD_LOCALE_CHOICE_STATE, () => null)
    const cookie = useCookie<string | null>(UI_LOCALE_COOKIE, uiLocaleCookieOptions())

    if (import.meta.server) {
      const event = useRequestEvent()
      state.value = event?.context.resolveUiLocale ? await event.context.resolveUiLocale() : DEFAULT_APP_LOCALE
      // A signed-in user's profile choice wins; mirror it into the cookie so
      // the language survives a sign-out on this browser.
      if (event?.context.uiLocaleFromProfile && cookie.value !== state.value) {
        cookie.value = state.value
      }
      cardLocaleChoice.value = event?.context.resolveCardLocaleChoice ? await event.context.resolveCardLocaleChoice() : null
    }

    const target = state.value ?? (isAppLocale(cookie.value) ? cookie.value : DEFAULT_APP_LOCALE)
    // Typed by hand: inside its own plugin, NuxtApp's injection types are
    // circular and `$i18n` degrades to `unknown`.
    const i18n = nuxtApp.$i18n as Composer
    if (i18n.locale.value !== target) {
      await i18n.setLocale(target)
    }
  },
})
