import type { OwnProfile } from '~~/shared/sharing'
import { DEFAULT_APP_LOCALE, isAppLocale, UI_LOCALE_COOKIE } from '~~/shared/locale'
import type { AppLocale } from '~~/shared/locale'
import { uiLocaleCookieOptions } from '~/utils/ui-locale'

/**
 * The active interface language and a way to change it (ADR 0014).
 *
 * `change(next)`:
 * - signed in (the shared `own-profile` data is loaded — every signed-in
 *   layout loads it): `PATCH /api/profile { locale }` first; a failure
 *   throws and nothing switches, so the caller can show an error;
 * - then switches vue-i18n and writes the `ui_locale` cookie (for signed-in
 *   users too, so the choice survives a sign-out).
 */
export function useUiLocale() {
  const { locale: i18nLocale, setLocale } = useI18n()
  const cookie = useCookie<string | null>(UI_LOCALE_COOKIE, uiLocaleCookieOptions())
  const { data: ownProfile } = useNuxtData<OwnProfile | null>('own-profile')

  const locale = computed<AppLocale>(() => isAppLocale(i18nLocale.value) ? i18nLocale.value : DEFAULT_APP_LOCALE)

  async function change(next: AppLocale): Promise<void> {
    if (ownProfile.value) {
      ownProfile.value = await $fetch<OwnProfile>('/api/profile', {
        method: 'PATCH',
        body: { locale: next },
      })
    }
    cookie.value = next
    if (i18nLocale.value !== next) {
      await setLocale(next)
    }
  }

  return { locale, change }
}
