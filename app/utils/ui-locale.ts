import type { CookieOptions } from 'nuxt/app'

/** `ui_locale` cookie (ADR 0014): one year, readable by the client, sent on top-level navigations. */
export function uiLocaleCookieOptions(): CookieOptions<string | null> & { readonly?: false } {
  return { maxAge: 31_536_000, sameSite: 'lax', path: '/' }
}

/** The `useState` key of the profile's card language choice (ADR 0015), set during SSR by app/plugins/ui-locale.ts. */
export const CARD_LOCALE_CHOICE_STATE = 'card-locale-choice'
