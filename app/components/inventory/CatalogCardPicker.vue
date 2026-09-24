<script setup lang="ts">
interface CatalogCard {
  id: number
  name: string
  nameDe: string | null
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

const { t } = useI18n()
const { cardName, cardValue } = useCardText()

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
      :placeholder="t('inventory.picker.searchPlaceholder')"
      :aria-label="t('inventory.picker.searchLabel')"
      autofocus
    />

    <div class="max-h-96 overflow-y-auto rounded-lg border border-default bg-default">
      <div
        v-if="pending"
        class="p-4 text-sm text-muted"
      >
        {{ t('inventory.picker.searching') }}
      </div>

      <button
        v-for="card in data.items"
        :key="card.id"
        type="button"
        class="flex w-full items-center gap-3 border-b border-muted px-3 py-2 text-left last:border-b-0 hover:bg-elevated/50"
        @click="emit('select', card)"
      >
        <CardThumb
          :src="card.imageUrlSmall"
          :alt="cardName(card)"
          size="sm"
        />
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ cardName(card) }}</span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <CardFrameDot :type="card.type" />
            <span class="truncate">{{ cardValue('type', card.type) }}</span>
          </span>
        </span>
      </button>

      <div
        v-if="!pending && data.items.length === 0"
        class="p-4 text-sm text-muted"
      >
        {{ t('inventory.picker.noResults') }}
      </div>
    </div>
  </div>
</template>
