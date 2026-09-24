<script setup lang="ts">
import { breakdownKey, breakdownLabel, cardSubtitle } from '~/utils/inventory-search-result'
import type { InventorySearchResultItem } from '~/utils/inventory-search-result'

const props = defineProps<{
  item: InventorySearchResultItem | null
}>()

defineEmits<{
  // Jump to this card's individual rows in "Liste" (edit / reassign them).
  'edit-in-list': [item: InventorySearchResultItem]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { cardName, cardValue } = useCardText()

const imageSrc = computed(() => props.item ? (props.item.imageLarge ?? props.item.imageSmall) : null)
const isMonster = computed(() => props.item ? props.item.atk !== null || props.item.def !== null : false)
</script>

<template>
  <CardImageModal
    v-model:open="open"
    :title="item ? cardName(item) : ''"
    :description="item ? cardSubtitle(item, cardValue) : undefined"
    :src="imageSrc"
  >
    <template v-if="item">
      <dl
        v-if="isMonster"
        class="flex justify-center gap-6 text-sm"
      >
        <div class="flex items-baseline gap-1.5">
          <dt class="eyebrow">
            ATK
          </dt>
          <dd class="font-numeric text-base font-bold tracking-[0.04em] text-highlighted tabular-nums">
            {{ item.atk ?? '?' }}
          </dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt class="eyebrow">
            DEF
          </dt>
          <dd class="font-numeric text-base font-bold tracking-[0.04em] text-highlighted tabular-nums">
            {{ item.def ?? '?' }}
          </dd>
        </div>
      </dl>

      <div class="space-y-1 rounded-lg border border-default bg-elevated/40 p-3">
        <p class="font-numeric text-sm font-semibold tracking-[0.04em] text-highlighted tabular-nums">
          {{ t('card.totalQuantity', { count: item.totalQuantity }) }}
        </p>
        <div
          v-for="entry in item.collectionBreakdown ?? []"
          :key="breakdownKey(entry)"
          class="flex items-center justify-between gap-4 text-sm"
        >
          <span class="min-w-0 truncate text-default">{{ breakdownLabel(entry, t) }}</span>
          <span class="font-medium tabular-nums text-highlighted">×{{ entry.quantity }}</span>
        </div>
      </div>

      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          icon="i-lucide-list"
          :label="t('inventory.preview.editInList')"
          color="neutral"
          variant="outline"
          @click="$emit('edit-in-list', item)"
        />
        <UButton
          :to="`/catalog?card=${item.catalogCardId}`"
          icon="i-lucide-book-open"
          :label="t('inventory.preview.openInCatalog')"
          color="neutral"
          variant="outline"
        />
      </div>
    </template>
  </CardImageModal>
</template>
