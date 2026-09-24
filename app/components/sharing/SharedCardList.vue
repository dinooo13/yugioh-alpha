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

const { t } = useI18n()
const { cardName, cardValue } = useCardText()

const searchInput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emit('update:search', value.trim())
  }, 300)
})

const sortItems = computed(() => [
  { label: t('sharing.cardList.sort.nameAsc'), value: 'name' },
  { label: t('sharing.cardList.sort.nameDesc'), value: '-name' },
  { label: t('sharing.cardList.sort.quantity'), value: 'quantity' },
])
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
  return [cardValue('type', card.type), card.level !== null ? t('card.stars', { level: card.level }) : null, card.attribute ? cardValue('attribute', card.attribute) : null]
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
        :placeholder="t('sharing.cardList.searchPlaceholder')"
        :aria-label="t('sharing.cardList.searchLabel')"
        class="w-full max-w-xl"
      />
      <USelect
        v-model="sortValue"
        :items="sortItems"
        :aria-label="t('sharing.cardList.sortLabel')"
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
      {{ t('sharing.cardList.empty') }}
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
        <CardThumb
          :src="card.imageSmall"
          :alt="cardName(card)"
          size="sm"
          :src-large="card.imageLarge"
          enlargeable
        />

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900">
            {{ cardName(card) }}
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
        :aria-label="t('common.pagination.previous')"
        @click="previousPage"
      />
      <span class="min-w-28 text-center text-sm text-gray-600">
        {{ t('common.pagination.pageOf', { page, total: totalPages }) }}
      </span>
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        :disabled="page >= totalPages"
        :aria-label="t('common.pagination.next')"
        @click="nextPage"
      />
    </div>
  </div>
</template>
