<script setup lang="ts">
/**
 * "Im Inventar": how many copies of a card the user owns, per collection,
 * with each collection's note. The inventory's section of the card detail
 * overlay (`CardDetailModal`, #88).
 *
 * The quantities come with the search result; the notes are loaded from
 * `GET /api/inventory?catalogCardId=` (one row per card and collection since
 * ADR 0017). They are secondary: while they load, or when that fails, the
 * section simply shows no notes.
 */
import { breakdownKey, breakdownLabel } from '~/utils/inventory-search-result'
import type { InventorySearchResultItem } from '~/utils/inventory-search-result'

const props = defineProps<{
  item: InventorySearchResultItem
}>()

interface OwnedCardRow {
  collectionId: string | null
  note: string | null
}

const { t, n } = useI18n()

const notes = ref<Map<string, string>>(new Map())
let latest = 0

watch(() => props.item.catalogCardId, async (catalogCardId) => {
  const request = ++latest
  notes.value = new Map()
  if (import.meta.server) {
    return
  }
  try {
    const { items } = await $fetch<{ items: OwnedCardRow[] }>('/api/inventory', {
      query: { catalogCardId, pageSize: 100 },
    })
    if (request !== latest) {
      return
    }
    const next = new Map<string, string>()
    for (const row of items) {
      const note = row.note?.trim()
      if (!note) {
        continue
      }
      // Keyed like `breakdownKey`: the collection id, or `__none__` for no collection.
      const key = row.collectionId ?? '__none__'
      const previous = next.get(key)
      next.set(key, previous ? `${previous}\n${note}` : note)
    }
    notes.value = next
  }
  catch {
    // No notes then; the quantities are what matters here.
  }
}, { immediate: true })
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-highlighted">
      {{ t('inventory.preview.owned') }}
    </h3>
    <div class="mt-2 space-y-2 rounded-lg border border-default bg-elevated/40 p-3">
      <p class="font-numeric text-sm font-semibold tracking-[0.04em] text-highlighted tabular-nums">
        {{ t('card.totalQuantity', { count: n(item.totalQuantity, 'integer') }) }}
      </p>
      <div
        v-for="entry in item.collectionBreakdown ?? []"
        :key="breakdownKey(entry)"
        class="text-sm"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="min-w-0 truncate text-default">{{ breakdownLabel(entry, t) }}</span>
          <span class="font-medium tabular-nums text-highlighted">×{{ n(entry.quantity, 'integer') }}</span>
        </div>
        <p
          v-if="notes.get(breakdownKey(entry))"
          class="mt-0.5 whitespace-pre-line break-words text-xs text-muted"
        >
          <span class="sr-only">{{ t('card.field.note') }}: </span>{{ notes.get(breakdownKey(entry)) }}
        </p>
      </div>
    </div>
  </section>
</template>
