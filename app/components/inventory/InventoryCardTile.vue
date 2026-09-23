<script setup lang="ts">
import { breakdownKey, breakdownLabel, cardSubtitle } from '~/utils/inventory-search-result'
import type { InventorySearchResultItem } from '~/utils/inventory-search-result'

const props = defineProps<{
  item: InventorySearchResultItem
}>()

const emit = defineEmits<{
  preview: []
}>()

const breakdown = computed(() => props.item.collectionBreakdown ?? [])
const showInline = computed(() => breakdown.value.length <= 2)
const subtitle = computed(() => cardSubtitle(props.item))
</script>

<template>
  <article class="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
    <button
      type="button"
      :aria-label="`${item.name} vergrößern`"
      class="block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      @click="emit('preview')"
    >
      <!-- Not `enlargeable`: the tile's own preview modal shows more than the scan. -->
      <CardThumb
        :src="item.imageSmall"
        :src-large="item.imageLarge"
        :alt="item.name"
        size="full"
        sizes="(min-width: 1280px) 270px, (min-width: 640px) 30vw, 48vw"
      />
    </button>

    <div class="space-y-2 p-3">
      <div class="space-y-0.5">
        <h2 class="line-clamp-2 text-sm font-semibold leading-5 text-gray-900 group-hover:text-primary sm:text-base">
          {{ item.name }}
        </h2>
        <p class="truncate text-xs text-gray-500">
          {{ subtitle }}
        </p>
      </div>

      <p class="text-sm font-semibold tabular-nums text-gray-900">
        ×{{ item.totalQuantity }} ges.
      </p>

      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <template v-if="showInline">
          <UBadge
            v-for="entry in breakdown"
            :key="breakdownKey(entry)"
            color="neutral"
            variant="subtle"
            class="max-w-full"
          >
            <span class="truncate">{{ breakdownLabel(entry) }} ×{{ entry.quantity }}</span>
          </UBadge>
        </template>
        <UPopover v-else>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            trailing-icon="i-lucide-chevron-down"
            label="Aufschlüsselung"
            class="tap-target"
          />
          <template #content>
            <div class="min-w-48 space-y-1 p-3">
              <div
                v-for="entry in breakdown"
                :key="breakdownKey(entry)"
                class="flex items-center justify-between gap-4 text-sm"
              >
                <span class="text-gray-700">{{ breakdownLabel(entry) }}</span>
                <span class="font-medium tabular-nums text-gray-900">×{{ entry.quantity }}</span>
              </div>
            </div>
          </template>
        </UPopover>
      </div>
    </div>
  </article>
</template>
