// Special `collectionId` value selecting owned cards that are not assigned
// to any collection (i.e. `owned_card.collection_id IS NULL`). Shared by the
// inventory endpoints and the `/inventory` page (`?collectionId=__none__`).
export const UNASSIGNED_COLLECTION_ID = '__none__'

// Properties of an owned copy (ADR 0002). Value lists only — the UI labels
// live in the i18n catalogues (`card.printingLanguage.<v>`,
// `card.condition.<v>`, `card.edition.<v>`; ADR 0014). The server validates
// against these, the UI builds its selects from them.
export const PRINTING_LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja', 'ko'] as const
export const CARD_CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'] as const
export const CARD_EDITIONS = ['first', 'unlimited', 'limited'] as const

export type PrintingLanguage = typeof PRINTING_LANGUAGES[number]
export type CardCondition = typeof CARD_CONDITIONS[number]
export type CardEdition = typeof CARD_EDITIONS[number]
