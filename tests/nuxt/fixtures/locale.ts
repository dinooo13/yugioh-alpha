import type { Composer } from 'vue-i18n'
import type { AppLocale } from '~~/shared/locale'

/**
 * Switches the interface language of the test app. Tests run in German by
 * default; every file that calls this resets it with
 * `afterEach(() => setTestLocale('de'))`.
 */
export async function setTestLocale(locale: AppLocale): Promise<void> {
  await (useNuxtApp().$i18n as Composer).setLocale(locale)
}
