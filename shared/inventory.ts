// Special `collectionId` value selecting owned cards that are not assigned
// to any collection (i.e. `owned_card.collection_id IS NULL`). Shared by the
// inventory endpoints and the `/inventory` page (`?collectionId=__none__`).
export const UNASSIGNED_COLLECTION_ID = '__none__'
