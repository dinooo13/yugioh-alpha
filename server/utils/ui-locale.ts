import type { H3Event } from 'h3'
import { getCookie, getRequestHeader } from 'h3'
import { useDb } from '../db'
import { pickUiLocale, UI_LOCALE_COOKIE } from '../../shared/locale'
import type { AppLocale } from '../../shared/locale'
import { getProfileByUserId } from './profiles'
import { getOptionalUser } from './session'

/**
 * The interface language of this request (ADR 0014): the signed-in user's
 * profile choice, else the `ui_locale` cookie, else `Accept-Language` (only
 * once DETECT_ACCEPT_LANGUAGE is on), else German. Resolved once per request
 * and cached on `event.context`.
 */
export async function resolveUiLocale(event: H3Event): Promise<AppLocale> {
  if (event.context.uiLocale) {
    return event.context.uiLocale
  }

  const user = await getOptionalUser(event)
  const profileLocale = user ? getProfileByUserId(useDb(), user.id)?.locale ?? null : null
  const locale = pickUiLocale({
    profile: profileLocale,
    cookie: getCookie(event, UI_LOCALE_COOKIE),
    acceptLanguage: getRequestHeader(event, 'accept-language'),
  })

  event.context.uiLocale = locale
  event.context.uiLocaleFromProfile = profileLocale === locale
  return locale
}
