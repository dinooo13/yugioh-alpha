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
 * The signed-in user's collections (sidebar list + inventory assignment
 * dropdown/facet). A shared `key` means Nuxt dedupes this across every
 * caller on the same page — without it, the layout sidebar and
 * `/inventar` each kept their own separate copy, so creating a collection
 * or assigning a card in one never showed up in the other until a full
 * reload (UX review #4).
 */
export function useCollections() {
  return useFetch<CollectionsResponse>('/api/collections', {
    key: 'collections',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    default: () => ({ items: [], allCount: 0 }),
  })
}
