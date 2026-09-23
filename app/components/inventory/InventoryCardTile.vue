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

const imageSrc = computed(() => props.item.imageLarge ?? props.item.imageSmall)
// Small (168px) and full (421px) scans of the same artwork — let the browser
// pick the cheapest one that is still sharp at the rendered tile width.
const imageSrcset = computed(() => props.item.imageSmall && props.item.imageLarge
  ? `${props.item.imageSmall} 168w, ${props.item.imageLarge} 421w`
  : undefined)
</script>

<template>
  <article class="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
    <button
      type="button"
      :aria-label="`${item.name} vergrößern`"
      class="block aspect-[59/86] w-full bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      @click="emit('preview')"
    >
      <img
        v-if="imageSrc"
        :src="imageSrc"
        :srcset="imageSrcset"
        sizes="(min-width: 1280px) 270px, (min-width: 640px) 30vw, 48vw"
        :alt="item.name"
        loading="lazy"
        decoding="async"
        class="h-full w-full object-contain"
      >
      <span
        v-else
        class="flex h-full items-center justify-center px-3 text-center text-xs text-gray-400"
      >
        Kein Bild
      </span>
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
