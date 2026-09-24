import type { Ref } from 'vue'
import type { CatalogCardDetail } from '~/utils/card-detail'

/**
 * Loads `GET /api/catalog/cards/:id` for the card detail overlay (#88).
 *
 * - `null` keeps the last detail, so a closing overlay doesn't collapse
 *   during its close animation; a new id clears it before loading.
 * - Only the latest request counts: switching A→B quickly never shows A's
 *   text for B.
 * - Nothing is fetched during SSR: the server and the client both render the
 *   pending state, and the client loads the card after hydration.
 */
export function useCatalogCardDetail(cardId: Ref<number | null>) {
  const detail = ref<CatalogCardDetail | null>(null)
  const pending = ref(false)
  const error = ref<Error | null>(null)
  let latest = 0

  watch(cardId, async (id) => {
    if (id === null || !Number.isFinite(id)) {
      return
    }

    const request = ++latest
    detail.value = null
    error.value = null
    pending.value = true

    if (import.meta.server) {
      return
    }

    try {
      const result = await $fetch<CatalogCardDetail>(`/api/catalog/cards/${id}`)
      if (request === latest) {
        detail.value = result
      }
    }
    catch (cause) {
      if (request === latest) {
        error.value = cause instanceof Error ? cause : new Error(String(cause))
      }
    }
    finally {
      if (request === latest) {
        pending.value = false
      }
    }
  }, { immediate: true })

  return { detail, pending, error }
}
