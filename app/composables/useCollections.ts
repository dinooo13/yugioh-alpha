import type { Visibility } from '~~/shared/sharing'

export interface CollectionItem {
  id: string
  name: string
  description: string | null
  cardCount: number
  visibility: Visibility
}

export interface CollectionsResponse {
  items: CollectionItem[]
  allCount: number
}

/**
 * The signed-in user's collections (inventory collection menu, per-row
 * assignment dropdown, add-to-inventory modal) and the total copy count
 * (`allCount`, also shown on the dashboard). A shared `key` means Nuxt
 * dedupes this across every caller on the same page, so one `refresh()`
 * after creating a collection or assigning a card updates every consumer
 * at once (UX review #4).
 */
export function useCollections() {
  return useFetch<CollectionsResponse>('/api/collections', {
    key: 'collections',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    default: () => ({ items: [], allCount: 0 }),
  })
}
