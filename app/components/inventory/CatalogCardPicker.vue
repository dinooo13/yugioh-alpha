<script setup lang="ts">
interface CatalogCard {
  id: number
  name: string
  type: string
  imageUrlSmall: string | null
  printings: Array<{
    id: string
    cardId: number
    setName: string
    rarity: string | null
  }>
}

const emit = defineEmits<{
  select: [card: CatalogCard]
}>()

const query = ref('')
const debouncedQuery = ref('')

let timeout: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  if (timeout) {
    clearTimeout(timeout)
  }
  timeout = setTimeout(() => {
    debouncedQuery.value = value
  }, 250)
})

const { data, pending } = await useFetch<{ items: CatalogCard[] }>('/api/inventory/catalog-cards', {
  query: { q: debouncedQuery },
  default: () => ({ items: [] }),
  watch: [debouncedQuery],
})
</script>

<template>
  <div class="space-y-3">
    <UInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="Katalog durchsuchen..."
      aria-label="Katalog durchsuchen"
    />

    <div class="max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-white">
      <div
        v-if="pending"
        class="p-4 text-sm text-gray-500"
      >
        Suche läuft...
      </div>

      <button
        v-for="card in data.items"
        :key="card.id"
        type="button"
        class="flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
        @click="emit('select', card)"
      >
        <img
          v-if="card.imageUrlSmall"
          :src="card.imageUrlSmall"
          :alt="card.name"
          class="h-14 w-10 rounded object-cover"
        >
        <div
          v-else
          class="flex h-14 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
        >
          —
        </div>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-gray-900">{{ card.name }}</span>
          <span class="block truncate text-xs text-gray-500">{{ card.type }}</span>
        </span>
      </button>

      <div
        v-if="!pending && data.items.length === 0"
        class="p-4 text-sm text-gray-500"
      >
        Keine Karten gefunden.
      </div>
    </div>
  </div>
</template>
