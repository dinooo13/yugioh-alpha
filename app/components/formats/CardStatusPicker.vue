<script setup lang="ts">
// Picks individual catalog cards for a `card_status` rule: a debounced search
// against /api/catalog/cards plus removable chips for the selected cards.
// Names of already-selected cards come from the format response
// (`cardNames`, already in the card language), so editing a saved rule never
// shows bare passcodes.

interface CatalogSearchItem {
  id: number
  name: string
  nameDe: string | null
  type: string
}

const props = defineProps<{
  modelValue: number[]
  cardNames: Record<string, string>
  disabled?: boolean
  label?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
  'resolved': [cards: Array<{ id: number, name: string }>]
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()

const search = ref('')
const results = ref<CatalogSearchItem[]>([])
const isSearching = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | undefined

watch(search, (value) => {
  clearTimeout(debounceTimer)
  const term = value.trim()
  if (term === '') {
    results.value = []
    return
  }

  debounceTimer = setTimeout(async () => {
    isSearching.value = true
    try {
      const response = await $fetch<{ items: CatalogSearchItem[] }>('/api/catalog/cards', {
        query: { q: term, pageSize: 8, sort: 'name' },
      })
      results.value = response.items ?? []
    }
    catch {
      results.value = []
    }
    finally {
      isSearching.value = false
    }
  }, 300)
})

function nameFor(id: number): string {
  return props.cardNames[String(id)] ?? `#${id}`
}

function addCard(card: CatalogSearchItem) {
  if (!props.modelValue.includes(card.id)) {
    emit('resolved', [{ id: card.id, name: cardName(card) }])
    emit('update:modelValue', [...props.modelValue, card.id])
  }
  search.value = ''
  results.value = []
}

function removeCard(id: number) {
  emit('update:modelValue', props.modelValue.filter(entry => entry !== id))
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-if="modelValue.length > 0"
      class="flex flex-wrap gap-1.5"
    >
      <span
        v-for="id in modelValue"
        :key="id"
        class="inline-flex items-center gap-1 rounded-full bg-elevated py-0.5 pl-2.5 pr-1 text-xs text-default"
      >
        {{ nameFor(id) }}
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :disabled="disabled"
          :aria-label="t('formats.cardPicker.remove', { name: nameFor(id) })"
          class="tap-target"
          @click="removeCard(id)"
        />
      </span>
    </div>
    <p
      v-else
      class="text-xs text-muted"
    >
      {{ t('formats.cardPicker.none') }}
    </p>

    <UInput
      v-model="search"
      icon="i-lucide-search"
      :disabled="disabled"
      :placeholder="t('formats.cardPicker.searchPlaceholder')"
      :aria-label="label ?? t('formats.cardPicker.searchLabel')"
    />

    <ul
      v-if="results.length > 0"
      class="max-h-48 divide-y divide-default overflow-y-auto rounded-md border border-default"
    >
      <li
        v-for="card in results"
        :key="card.id"
      >
        <button
          type="button"
          class="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-elevated/50"
          :disabled="disabled"
          @click="addCard(card)"
        >
          <span class="text-sm text-highlighted">{{ cardName(card) }}</span>
          <span class="text-xs text-muted">{{ cardValue('type', card.type) }}</span>
        </button>
      </li>
    </ul>

    <p
      v-else-if="isSearching"
      class="text-xs text-muted"
    >
      {{ t('formats.cardPicker.searching') }}
    </p>
  </div>
</template>
