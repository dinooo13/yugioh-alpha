// Special `collectionId` value selecting owned cards that are not assigned
// to any collection (i.e. `owned_card.collection_id IS NULL`). Shared by the
// inventory endpoints and the `/inventory` page (`?collectionId=__none__`).
export const UNASSIGNED_COLLECTION_ID = '__none__'

/**
 * Upper bound for a single owned-card stack. Guards against a typo (or a
 * misparsed entry line) turning into a five-digit quantity. The server
 * rejects more (`quantity_too_large`); the quantity steppers stop here.
 */
export const MAX_OWNED_QUANTITY = 999

/**
 * How many characters of the card text a "Liste" row of the inventory gets
 * (`GET /api/inventory`'s `cardTextExcerpt` / `cardTextExcerptDe`). The row
 * clamps it to two lines and adds "…" when the text was cut.
 */
export const CARD_TEXT_EXCERPT_LENGTH = 240
