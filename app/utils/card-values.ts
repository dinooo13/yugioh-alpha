// Labels for the card data values YGOPRODeck stores in English — card type,
// attribute and race (which also holds the Spell/Trap subtype) — in the card
// language (ADR 0015). Stored values, filter values and API parameters stay
// English; only what is shown changes.
//
// The labels are the i18n messages `card.value.<kind>.<slug>`. German uses
// Konami's official vocabulary as the ygoresources card-history repo spells it
// (`localizedAttribute`, the type line in `properties`, `localizedProperty`
// for Spell/Trap subtypes) and as the official German card texts name the
// monster card types ("Effektmonster", "Empfänger-Monster", "Spielmarke", …);
// composite types ("Pendulum Effect Monster") are compounds of those words.
// "Skill-Karte" follows Konami EU's German Speed Duel material; "Creator God"
// (Holactie only, OCG/promo) has no official German print, so "Schöpfergott"
// is a literal translation (#102).
// English labels are the stored values themselves.

export type CardValueKind = 'type' | 'attribute' | 'race'

/**
 * The message key of a stored value: lowercased, every character that isn't
 * a letter or digit replaced by `_` ("Beast-Warrior" → `beast_warrior`).
 * Lowercasing also matches values a rule format stored in another case
 * (rule filters compare ignoring case).
 */
export function cardValueKey(kind: CardValueKind, value: string): string {
  return `card.value.${kind}.${value.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
}
