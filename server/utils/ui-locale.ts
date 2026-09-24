import type { H3Event } from 'h3'
import { getCookie, getRequestHeader } from 'h3'
import { useDb } from '../db'
import { isAppLocale, pickUiLocale, UI_LOCALE_COOKIE } from '../../shared/locale'
import type { AppLocale } from '../../shared/locale'
import { getProfileByUserId } from './profiles'
import { getOptionalUser } from './session'

type LocaleChoices = { locale: AppLocale | null, cardLocale: AppLocale | null }

/**
 * The signed-in user's interface and card language choices, read from the
 * profile row once per request (both resolvers below need them). `null` for
 * anonymous visitors and users without a profile row.
 */
async function loadLocaleChoices(event: H3Event): Promise<LocaleChoices | null> {
  if (event.context.localeChoices !== undefined) {
    return event.context.localeChoices
  }

  const user = await getOptionalUser(event)
  const profile = user ? getProfileByUserId(useDb(), user.id) : undefined
  const choices = profile
    ? {
        locale: isAppLocale(profile.locale) ? profile.locale : null,
        cardLocale: isAppLocale(profile.cardLocale) ? profile.cardLocale : null,
      }
    : null
  event.context.localeChoices = choices
  return choices
}

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

  const profileLocale = (await loadLocaleChoices(event))?.locale ?? null
  const locale = pickUiLocale({
    profile: profileLocale,
    cookie: getCookie(event, UI_LOCALE_COOKIE),
    acceptLanguage: getRequestHeader(event, 'accept-language'),
  })

  event.context.uiLocale = locale
  event.context.uiLocaleFromProfile = profileLocale === locale
  return locale
}

/**
 * The card language the signed-in user picked on their profile (ADR 0015),
 * or `null` — anonymous, or "follow the interface language". Cached on
 * `event.context`.
 */
export async function resolveCardLocaleChoice(event: H3Event): Promise<AppLocale | null> {
  if (event.context.cardLocaleChoice !== undefined) {
    return event.context.cardLocaleChoice
  }

  const choice = (await loadLocaleChoices(event))?.cardLocale ?? null
  event.context.cardLocaleChoice = choice
  return choice
}

/**
 * The card language of this request (ADR 0015): the profile's choice, else
 * the interface language. The server only needs it to sort by card name —
 * payloads always carry both `name` and `nameDe`, and the client picks.
 */
export async function resolveCardLocale(event: H3Event): Promise<AppLocale> {
  return (await resolveCardLocaleChoice(event)) ?? (await resolveUiLocale(event))
}
