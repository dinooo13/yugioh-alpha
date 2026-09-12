<script setup lang="ts">
import type { SharedCardListItem } from '~~/shared/sharing'

type SharedCardSort = 'name' | '-name' | 'quantity'

const props = defineProps<{
  items: SharedCardListItem[]
  total: number
  page: number
  pageSize: number
  pending?: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:sort': [value: SharedCardSort]
  'update:page': [value: number]
}>()

const searchInput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emit('update:search', value.trim())
  }, 300)
})

const sortItems = [
  { label: 'Name A–Z', value: 'name' },
  { label: 'Name Z–A', value: '-name' },
  { label: 'Anzahl', value: 'quantity' },
]
const sortValue = ref<SharedCardSort>('name')
watch(sortValue, value => emit('update:sort', value))

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

function previousPage() {
  emit('update:page', Math.max(1, props.page - 1))
}
function nextPage() {
  emit('update:page', Math.min(totalPages.value, props.page + 1))
}

function cardMetaLine(card: SharedCardListItem): string {
  return [card.type, card.level !== null ? `Stufe ${card.level}` : null, card.attribute]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="searchInput"
        icon="i-lucide-search"
        placeholder="Karten durchsuchen..."
        aria-label="Karten durchsuchen"
        class="w-full max-w-xl"
      />
      <USelect
        v-model="sortValue"
        :items="sortItems"
        aria-label="Sortierung"
        class="w-48"
      />
    </div>

    <div
      v-if="pending"
      class="space-y-2"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-16 w-full"
      />
    </div>

    <p
      v-else-if="items.length === 0"
      class="text-sm text-gray-500"
    >
      Keine Karten gefunden.
    </p>

    <ul
      v-else
      class="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white"
    >
      <li
        v-for="card in items"
        :key="card.catalogCardId"
        class="flex items-center gap-3 px-4 py-2"
      >
        <img
          v-if="card.imageSmall"
          :src="card.imageSmall"
          :alt="card.name"
          class="h-14 w-10 shrink-0 rounded object-cover"
        >
        <div
          v-else
          class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
        >
          —
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900">
            {{ card.name }}
          </p>
          <p class="truncate text-xs text-gray-500">
            {{ cardMetaLine(card) }}
          </p>
        </div>

        <span class="shrink-0 text-sm font-semibold tabular-nums text-gray-700">
          {{ card.quantity }}×
        </span>
      </li>
    </ul>

    <div
      v-if="total > pageSize"
      class="flex items-center justify-center gap-2"
    >
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        :disabled="page <= 1"
        aria-label="Vorherige Seite"
        @click="previousPage"
      />
      <span class="min-w-28 text-center text-sm text-gray-600">
        Seite {{ page }} / {{ totalPages }}
      </span>
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        :disabled="page >= totalPages"
        aria-label="Nächste Seite"
        @click="nextPage"
      />
    </div>
  </div>
</template>
