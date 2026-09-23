import { describe, expect, it } from 'vitest'
import { isAppLocale, localeFromAcceptLanguage, pickUiLocale } from '~~/shared/locale'

describe('isAppLocale', () => {
  it('accepts only the supported codes', () => {
    expect(isAppLocale('de')).toBe(true)
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('fr')).toBe(false)
    expect(isAppLocale('EN')).toBe(false)
    expect(isAppLocale(null)).toBe(false)
    expect(isAppLocale(undefined)).toBe(false)
  })
})

describe('localeFromAcceptLanguage', () => {
  it('matches on the primary subtag', () => {
    expect(localeFromAcceptLanguage('de-AT')).toBe('de')
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en')
    expect(localeFromAcceptLanguage('EN-us')).toBe('en')
  })

  it('returns null for an unsupported, empty or garbled header', () => {
    expect(localeFromAcceptLanguage('fr')).toBeNull()
    expect(localeFromAcceptLanguage('')).toBeNull()
    expect(localeFromAcceptLanguage(null)).toBeNull()
    expect(localeFromAcceptLanguage(undefined)).toBeNull()
    expect(localeFromAcceptLanguage(';;;,,q=1')).toBeNull()
    expect(localeFromAcceptLanguage('*')).toBeNull()
  })

  it('orders by quality and skips unsupported languages', () => {
    expect(localeFromAcceptLanguage('fr, en;q=0.5')).toBe('en')
    expect(localeFromAcceptLanguage('en;q=0.4, de;q=0.8')).toBe('de')
    expect(localeFromAcceptLanguage('de, en')).toBe('de')
  })

  it('ignores q=0 ("not acceptable")', () => {
    expect(localeFromAcceptLanguage('en;q=0, fr')).toBeNull()
    expect(localeFromAcceptLanguage('en;q=0, de;q=0.1')).toBe('de')
  })
})

describe('pickUiLocale', () => {
  it('prefers the profile over the cookie', () => {
    expect(pickUiLocale({ profile: 'en', cookie: 'de' })).toBe('en')
    expect(pickUiLocale({ profile: 'de', cookie: 'en', acceptLanguage: 'en' }, true)).toBe('de')
  })

  it('uses the cookie when the profile has no choice', () => {
    expect(pickUiLocale({ profile: null, cookie: 'en' })).toBe('en')
  })

  it('ignores an invalid cookie', () => {
    expect(pickUiLocale({ cookie: 'fr' })).toBe('de')
    expect(pickUiLocale({ cookie: 'fr', acceptLanguage: 'en' }, true)).toBe('en')
  })

  it('uses Accept-Language only when header detection is on', () => {
    expect(pickUiLocale({ acceptLanguage: 'en-US,en;q=0.9' }, false)).toBe('de')
    expect(pickUiLocale({ acceptLanguage: 'en-US,en;q=0.9' }, true)).toBe('en')
    // F2a ships with detection off (DETECT_ACCEPT_LANGUAGE = false).
    expect(pickUiLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('de')
  })

  it('falls back to German for an unsupported header', () => {
    expect(pickUiLocale({ acceptLanguage: 'fr' }, true)).toBe('de')
    expect(pickUiLocale({})).toBe('de')
  })
})
