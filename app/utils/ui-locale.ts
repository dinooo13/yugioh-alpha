import type { CookieOptions } from 'nuxt/app'

/** `ui_locale` cookie (ADR 0014): one year, readable by the client, sent on top-level navigations. */
export function uiLocaleCookieOptions(): CookieOptions<string | null> & { readonly?: false } {
  return { maxAge: 31_536_000, sameSite: 'lax', path: '/' }
}
