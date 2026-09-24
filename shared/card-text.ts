import type { AppLocale } from './locale'

/** Where the German card names and texts come from (ADR 0015): Konami's official text, per card and language. */
export const CARD_TRANSLATION_REPO = 'db-ygoresources-com/yugioh-card-history'
export const CARD_TRANSLATION_REPO_URL = `https://github.com/${CARD_TRANSLATION_REPO}`

/**
 * Which name and text a card is shown with (ADR 0015). Payloads carry the
 * canonical English `name` / `desc` plus the official German `nameDe` /
 * `descDe` (null or absent when there is none); these pure helpers pick by
 * card language, falling back to English. Shared by the client
 * (`useCardText()`) and the server (sorting by display name).
 */
export interface CardNameFields {
  name: string
  nameDe?: string | null
}

export interface CardDescFields {
  desc: string | null
  descDe?: string | null
}

/** The card's name in `locale`, or the English name when there is no translation. */
export function pickCardName(card: CardNameFields, locale: AppLocale): string {
  return locale === 'de' && card.nameDe ? card.nameDe : card.name
}

/** The card's text in `locale`, or the English text when there is no translation. */
export function pickCardDesc(card: CardDescFields, locale: AppLocale): string | null {
  return locale === 'de' && card.descDe ? card.descDe : card.desc
}

/** Compares two cards by their display name in `locale` — for `Array.prototype.sort`. */
export function compareCardNames(a: CardNameFields, b: CardNameFields, locale: AppLocale): number {
  return pickCardName(a, locale).localeCompare(pickCardName(b, locale), locale)
}
