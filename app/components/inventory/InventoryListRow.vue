<script setup lang="ts">
interface InventoryListItem {
  id: string
  collectionId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  cardName: string
  cardType: string
  imageUrlSmall: string | null
  setName: string | null
  rarity: string | null
}

const props = defineProps<{
  item: InventoryListItem
  assignItems: Array<{ label: string, value: string }>
  noAssignmentValue: string
  editionLabels: Record<string, string>
  conditionLabels: Record<string, string>
}>()

const emit = defineEmits<{
  assign: [value: string]
  edit: []
  remove: []
}>()

const editionLabel = computed(() => props.editionLabels[props.item.edition] ?? props.item.edition)
const conditionLabel = computed(() => props.conditionLabels[props.item.condition] ?? props.item.condition)
const languageLabel = computed(() => props.item.language.toUpperCase())
</script>

<template>
  <!-- One markup for every width: stacked on phones, a single row from `sm`
       up. No column header — each attribute is a labelled badge instead. -->
  <li class="flex gap-3 px-4 py-3 sm:items-center">
    <div class="w-16 shrink-0 sm:w-12">
      <img
        v-if="item.imageUrlSmall"
        :src="item.imageUrlSmall"
        :alt="item.cardName"
        loading="lazy"
        decoding="async"
        class="aspect-[59/86] w-full rounded bg-gray-100 object-contain"
      >
      <div
        v-else
        class="flex aspect-[59/86] w-full items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
      >
        —
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div class="min-w-0 flex-1 space-y-1">
        <div class="line-clamp-2 text-sm font-medium text-gray-900 sm:truncate">
          {{ item.cardName }}
        </div>
        <div class="truncate text-xs text-gray-500">
          {{ item.cardType }}<span v-if="item.setName"> · {{ item.setName }}</span><span v-if="item.rarity"> · {{ item.rarity }}</span>
        </div>
        <div class="flex flex-wrap gap-1">
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="`Sprache: ${languageLabel}`"
          >
            <span class="sr-only">Sprache </span>{{ languageLabel }}
          </UBadge>
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="`Auflage: ${editionLabel}`"
          >
            <span class="sr-only">Auflage </span>{{ editionLabel }}
          </UBadge>
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="`Zustand: ${conditionLabel}`"
          >
            <span class="sr-only">Zustand </span>{{ conditionLabel }}
          </UBadge>
        </div>
      </div>

      <div class="flex min-w-0 items-center gap-2">
        <span class="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
          ×{{ item.quantity }}
        </span>
        <USelect
          :model-value="item.collectionId ?? noAssignmentValue"
          :items="assignItems"
          :aria-label="`Sammlung für ${item.cardName}`"
          class="min-w-0 flex-1 sm:w-44 sm:flex-none"
          @update:model-value="(value: string) => emit('assign', value)"
        />
        <div class="flex shrink-0 gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            aria-label="Karte bearbeiten"
            @click="emit('edit')"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            aria-label="Karte entfernen"
            @click="emit('remove')"
          />
        </div>
      </div>
    </div>
  </li>
</template>
