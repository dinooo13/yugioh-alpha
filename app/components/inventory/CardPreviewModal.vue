<script setup lang="ts">
import { breakdownKey, breakdownLabel, cardSubtitle } from '~/utils/inventory-search-result'
import type { InventorySearchResultItem } from '~/utils/inventory-search-result'

const props = defineProps<{
  item: InventorySearchResultItem | null
}>()

const open = defineModel<boolean>('open', { default: false })

const imageSrc = computed(() => props.item ? (props.item.imageLarge ?? props.item.imageSmall) : null)
const isMonster = computed(() => props.item ? props.item.atk !== null || props.item.def !== null : false)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="item?.name ?? ''"
    :description="item ? cardSubtitle(item) : undefined"
  >
    <template #body>
      <div
        v-if="item"
        class="space-y-4"
      >
        <img
          v-if="imageSrc"
          :src="imageSrc"
          :alt="item.name"
          decoding="async"
          class="mx-auto aspect-[59/86] max-h-[70vh] w-auto rounded-md object-contain"
        >
        <div
          v-else
          class="mx-auto flex aspect-[59/86] w-48 items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400"
        >
          Kein Bild
        </div>

        <dl
          v-if="isMonster"
          class="flex justify-center gap-6 text-sm"
        >
          <div class="flex gap-1">
            <dt class="text-gray-500">
              ATK
            </dt>
            <dd class="font-semibold tabular-nums text-gray-900">
              {{ item.atk ?? '?' }}
            </dd>
          </div>
          <div class="flex gap-1">
            <dt class="text-gray-500">
              DEF
            </dt>
            <dd class="font-semibold tabular-nums text-gray-900">
              {{ item.def ?? '?' }}
            </dd>
          </div>
        </dl>

        <div class="space-y-1 rounded-md border border-gray-200 p-3">
          <p class="text-sm font-semibold tabular-nums text-gray-900">
            ×{{ item.totalQuantity }} ges.
          </p>
          <div
            v-for="entry in item.collectionBreakdown ?? []"
            :key="breakdownKey(entry)"
            class="flex items-center justify-between gap-4 text-sm"
          >
            <span class="min-w-0 truncate text-gray-700">{{ breakdownLabel(entry) }}</span>
            <span class="font-medium tabular-nums text-gray-900">×{{ entry.quantity }}</span>
          </div>
        </div>

        <div class="flex justify-end">
          <UButton
            :to="`/katalog?card=${item.catalogCardId}`"
            icon="i-lucide-book-open"
            label="Im Katalog öffnen"
            color="neutral"
            variant="outline"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
