<script setup lang="ts">
import type { InventorySearchFilters } from '~/components/inventory/InventorySearchPanel.vue'

interface InventoryItem {
  id: string
  catalogCardId: number
  printingId: string | null
  collectionId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  note: string | null
  cardName: string
  cardType: string
  imageUrlSmall: string | null
  setName: string | null
  rarity: string | null
}

interface CatalogCard {
  id: number
  name: string
  type: string
  imageUrlSmall?: string | null
  printings?: Array<{
    id: string
    cardId: number
    setName: string
    rarity: string | null
  }>
}

interface CollectionOption {
  id: string
  name: string
  cardCount: number
}

interface SearchFilters extends InventorySearchFilters {
  q: string
  inText: boolean
  page: number
}

interface SearchCollectionBreakdown {
  collectionId: string | null
  collectionName: string | null
  quantity: number
}

interface SearchResultItem {
  catalogCardId: number
  name: string
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  totalQuantity: number
  collectionBreakdown?: SearchCollectionBreakdown[]
}

interface SearchResponse {
  items: SearchResultItem[]
  total: number
  page: number
  pageSize: number
}

interface SearchFacets {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  sets: Array<{ id: string, name: string }>
  languages: string[]
  conditions: string[]
  editions: string[]
}

function emptyFacets(): SearchFacets {
  return {
    types: [],
    attributes: [],
    races: [],
    levels: [],
    sets: [],
    languages: [],
    conditions: [],
    editions: [],
  }
}

useHead({ title: 'Inventar – yugioh alpha' })

const route = useRoute()
const page = ref(1)
const pageSize = 20
const isPickerOpen = ref(false)
const isEntryOpen = ref(false)
const selectedCard = ref<CatalogCard | null>(null)
const editingItem = ref<InventoryItem | null>(null)
const errorMessage = ref('')

const mode = ref<'liste' | 'uebersicht'>('liste')

const filters = ref<SearchFilters>({
  q: '',
  inText: false,
  type: [],
  attribute: [],
  race: [],
  level: [],
  setId: '',
  language: [],
  condition: [],
  edition: [],
  collectionId: '',
  sort: 'name',
  page: 1,
})

// The search text is debounced (~300ms) before it drives either fetch, while
// the input itself stays bound directly to `filters.q` for instant feedback.
const debouncedQ = ref('')
let qTimeout: ReturnType<typeof setTimeout> | undefined
watch(() => filters.value.q, (value) => {
  if (qTimeout) {
    clearTimeout(qTimeout)
  }
  qTimeout = setTimeout(() => {
    debouncedQ.value = value
  }, 300)
})

const collectionId = computed(() => {
  const value = route.query.collectionId
  return typeof value === 'string' ? value : undefined
})

// Sidebar deep-link (?collectionId=) pre-selects the "Sammlung" facet so the
// sidebar and the aggregated search stay consistent (does not force the
// "Übersicht" mode — the raw list keeps its existing collection-filtered
// behavior by default).
watch(collectionId, (value) => {
  filters.value.collectionId = value ?? ''
}, { immediate: true })

const { data, pending, refresh } = await useFetch<{ items: InventoryItem[], total: number }>('/api/inventory', {
  query: {
    q: debouncedQ,
    page,
    pageSize,
    collectionId,
  },
  default: () => ({ items: [], total: 0 }),
  watch: [debouncedQ, page, collectionId],
})

const items = computed(() => data.value.items)
const total = computed(() => data.value.total)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const collectionOptions = ref<CollectionOption[]>([])
const allCardsCount = ref(0)

async function loadCollections() {
  const response = await $fetch<{ items: CollectionOption[], allCount: number }>('/api/collections').catch(() => ({ items: [], allCount: 0 }))
  collectionOptions.value = response.items
  allCardsCount.value = response.allCount
}

await loadCollections()

const activeCollection = computed(() => collectionOptions.value.find(c => c.id === collectionId.value) ?? null)
const headerTitle = computed(() => activeCollection.value?.name ?? 'Alle Karten')
const headerCount = computed(() => activeCollection.value ? activeCollection.value.cardCount : allCardsCount.value)

const noAssignmentValue = '__no_collection__'
const assignItems = computed(() => [
  { label: '— (keine)', value: noAssignmentValue },
  ...collectionOptions.value.map(c => ({ label: c.name, value: c.id })),
])

async function assignToCollection(item: InventoryItem, value: string) {
  errorMessage.value = ''
  try {
    await $fetch(`/api/inventory/${item.id}`, {
      method: 'PATCH',
      body: { collectionId: value === noAssignmentValue ? null : value },
    })
    await Promise.all([refresh(), loadCollections(), refreshSearch()])
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Sammlung konnte nicht geändert werden.'
  }
}

const editionLabels: Record<string, string> = {
  first: '1st',
  unlimited: 'Unlimited',
  limited: 'Limited',
}

const conditionLabels: Record<string, string> = {
  mint: 'M',
  near_mint: 'NM',
  excellent: 'EX',
  good: 'GD',
  light_played: 'LP',
  played: 'PL',
  poor: 'PO',
}

// Any filter change resets both views back to page 1.
watch(debouncedQ, () => {
  page.value = 1
  filters.value.page = 1
})
watch(
  () => [
    filters.value.inText,
    filters.value.type,
    filters.value.attribute,
    filters.value.race,
    filters.value.level,
    filters.value.setId,
    filters.value.language,
    filters.value.condition,
    filters.value.edition,
    filters.value.collectionId,
    filters.value.sort,
  ],
  () => {
    filters.value.page = 1
  },
  { deep: true },
)

// Whether the search/filter panel has anything set (excluding the
// collection facet, which may just mirror the sidebar deep-link).
const hasActiveSearchFilters = computed(() => Boolean(
  filters.value.q
  || filters.value.type.length
  || filters.value.attribute.length
  || filters.value.race.length
  || filters.value.level.length
  || filters.value.setId
  || filters.value.language.length
  || filters.value.condition.length
  || filters.value.edition.length,
))

// Same, but including the collection facet — used for the Übersicht empty
// state ("leer" vs. "keine Treffer").
const hasAnyFilter = computed(() => hasActiveSearchFilters.value || Boolean(filters.value.collectionId))

// The moment the user actually starts searching/filtering, default to the
// aggregated "Übersicht" view (the toggle still lets them switch back).
watch(hasActiveSearchFilters, (active, wasActive) => {
  if (active && !wasActive) {
    mode.value = 'uebersicht'
  }
})

const searchPageSize = 24
const searchQuery = computed(() => ({
  q: debouncedQ.value || undefined,
  inText: filters.value.inText ? 1 : undefined,
  type: filters.value.type.length ? filters.value.type.join(',') : undefined,
  attribute: filters.value.attribute.length ? filters.value.attribute.join(',') : undefined,
  race: filters.value.race.length ? filters.value.race.join(',') : undefined,
  level: filters.value.level.length ? filters.value.level.join(',') : undefined,
  setId: filters.value.setId || undefined,
  language: filters.value.language.length ? filters.value.language.join(',') : undefined,
  condition: filters.value.condition.length ? filters.value.condition.join(',') : undefined,
  edition: filters.value.edition.length ? filters.value.edition.join(',') : undefined,
  collectionId: filters.value.collectionId || undefined,
  sort: filters.value.sort,
  page: filters.value.page,
  pageSize: searchPageSize,
}))

const {
  data: searchData,
  pending: searchPending,
  error: searchError,
  refresh: refreshSearch,
} = await useFetch<SearchResponse>('/api/inventory/search', {
  query: searchQuery,
  default: () => ({ items: [], total: 0, page: 1, pageSize: searchPageSize }),
  watch: [searchQuery],
})

const searchItems = computed<SearchResultItem[]>(() => searchData.value?.items ?? [])
const searchTotal = computed(() => searchData.value?.total ?? 0)
const searchPageCount = computed(() => Math.max(1, Math.ceil(searchTotal.value / searchPageSize)))

const { data: facetsData, refresh: refreshFacets } = await useFetch<SearchFacets>('/api/inventory/search/facets', {
  default: emptyFacets,
})

const facets = computed<SearchFacets>(() => ({
  types: facetsData.value?.types ?? [],
  attributes: facetsData.value?.attributes ?? [],
  races: facetsData.value?.races ?? [],
  levels: facetsData.value?.levels ?? [],
  sets: facetsData.value?.sets ?? [],
  languages: facetsData.value?.languages ?? [],
  conditions: facetsData.value?.conditions ?? [],
  editions: facetsData.value?.editions ?? [],
}))

function openAdd(card: CatalogCard) {
  selectedCard.value = card
  editingItem.value = null
  isPickerOpen.value = false
  isEntryOpen.value = true
}

function openEdit(item: InventoryItem) {
  selectedCard.value = {
    id: item.catalogCardId,
    name: item.cardName,
    type: item.cardType,
    imageUrlSmall: item.imageUrlSmall,
    printings: item.printingId
      ? [{ id: item.printingId, cardId: item.catalogCardId, setName: item.setName ?? '', rarity: item.rarity }]
      : [],
  }
  editingItem.value = item
  isEntryOpen.value = true
}

async function removeItem(item: InventoryItem) {
  errorMessage.value = ''
  const confirmed = window.confirm(`${item.cardName} aus dem Inventar entfernen?`)
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/inventory/${item.id}`, { method: 'DELETE' })
    await Promise.all([refresh(), loadCollections(), refreshSearch(), refreshFacets()])
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Karte konnte nicht entfernt werden.'
  }
}

async function onSaved() {
  await Promise.all([refresh(), loadCollections(), refreshSearch(), refreshFacets()])
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          {{ headerTitle }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ headerCount }} Karte<span v-if="headerCount !== 1">n</span>
        </p>
      </div>

      <UButton
        icon="i-lucide-plus"
        label="Karte hinzufügen"
        @click="() => { isPickerOpen = true }"
      />
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-1 flex-wrap items-center gap-3">
        <UInput
          v-model="filters.q"
          icon="i-lucide-search"
          placeholder="Im Inventar suchen..."
          aria-label="Inventar durchsuchen"
          class="w-full max-w-xl"
        />
        <UCheckbox
          v-model="filters.inText"
          label="Auch im Kartentext suchen"
        />
      </div>

      <UFieldGroup>
        <UButton
          label="Liste"
          color="neutral"
          :variant="mode === 'liste' ? 'solid' : 'outline'"
          @click="() => { mode = 'liste' }"
        />
        <UButton
          label="Übersicht"
          color="neutral"
          :variant="mode === 'uebersicht' ? 'solid' : 'outline'"
          @click="() => { mode = 'uebersicht' }"
        />
      </UFieldGroup>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>

    <!-- Übersicht: aggregated, faceted inventory-wide search -->
    <div
      v-if="mode === 'uebersicht'"
      class="space-y-4"
    >
      <InventorySearchPanel
        v-model:filters="filters"
        :facets="facets"
        :collections="collectionOptions"
        :edition-labels="editionLabels"
        :condition-labels="conditionLabels"
      />

      <p class="text-sm text-gray-500">
        {{ searchTotal }} Karte<span v-if="searchTotal !== 1">n</span>
      </p>

      <div class="overflow-hidden rounded-md border border-gray-200 bg-white">
        <div
          v-if="searchPending"
          class="space-y-3 p-4"
        >
          <USkeleton
            v-for="n in 4"
            :key="n"
            class="h-14 w-full"
          />
        </div>

        <UAlert
          v-else-if="searchError"
          color="error"
          variant="subtle"
          title="Die Suche konnte nicht geladen werden"
          :description="searchError.message"
          class="m-4"
        />

        <div
          v-else-if="searchItems.length === 0 && !hasAnyFilter"
          class="flex flex-col items-center px-6 py-12 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <UIcon
              name="i-lucide-archive"
              class="size-6"
            />
          </div>
          <h2 class="mt-4 text-base font-semibold text-gray-900">
            Inventar ist leer
          </h2>
          <p class="mt-1 max-w-sm text-sm text-gray-500">
            Suche eine Karte im Katalog und füge deine ersten Exemplare hinzu.
          </p>
          <UButton
            icon="i-lucide-plus"
            label="Karte hinzufügen"
            class="mt-4"
            @click="() => { isPickerOpen = true }"
          />
        </div>

        <div
          v-else-if="searchItems.length === 0"
          class="flex flex-col items-center px-6 py-12 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <UIcon
              name="i-lucide-search-x"
              class="size-6"
            />
          </div>
          <h2 class="mt-4 text-base font-semibold text-gray-900">
            Keine Treffer für diese Filter
          </h2>
          <p class="mt-1 max-w-sm text-sm text-gray-500">
            Passe die Suche oder die Filter an, um mehr Karten zu finden.
          </p>
        </div>

        <div
          v-else
          class="divide-y divide-gray-100"
        >
          <InventoryResultRow
            v-for="result in searchItems"
            :key="result.catalogCardId"
            :item="result"
          />
        </div>
      </div>

      <div
        v-if="searchTotal > searchPageSize"
        class="flex justify-end"
      >
        <UPagination
          v-model:page="filters.page"
          :total="searchTotal"
          :items-per-page="searchPageSize"
          :page-count="searchPageCount"
        />
      </div>
    </div>

    <!-- Liste: the existing raw per-row inventory list -->
    <div
      v-else
      class="space-y-4"
    >
      <div class="overflow-hidden rounded-md border border-gray-200 bg-white">
        <div
          v-if="pending"
          class="p-6 text-sm text-gray-500"
        >
          Inventar wird geladen...
        </div>

        <div
          v-else-if="items.length === 0"
          class="flex flex-col items-center px-6 py-12 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <UIcon
              name="i-lucide-archive"
              class="size-6"
            />
          </div>
          <h2 class="mt-4 text-base font-semibold text-gray-900">
            {{ collectionId ? 'Noch keine Karten in dieser Sammlung' : 'Keine Karten im Inventar' }}
          </h2>
          <p class="mt-1 max-w-sm text-sm text-gray-500">
            Suche eine Karte im Katalog und füge deine ersten Exemplare hinzu.
          </p>
          <UButton
            icon="i-lucide-plus"
            label="Karte hinzufügen"
            class="mt-4"
            @click="() => { isPickerOpen = true }"
          />
        </div>

        <table
          v-else
          class="w-full table-fixed divide-y divide-gray-200"
        >
          <thead class="bg-gray-50">
            <tr class="text-left text-xs font-semibold uppercase text-gray-500">
              <th class="w-16 px-4 py-3">
                Bild
              </th>
              <th class="px-4 py-3">
                Karte
              </th>
              <th class="w-20 px-4 py-3">
                Sprache
              </th>
              <th class="w-28 px-4 py-3">
                Edition
              </th>
              <th class="w-24 px-4 py-3">
                Zustand
              </th>
              <th class="w-20 px-4 py-3 text-right">
                Anzahl
              </th>
              <th class="w-40 px-4 py-3">
                Sammlung
              </th>
              <th class="w-24 px-4 py-3 text-right">
                Aktionen
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="item in items"
              :key="item.id"
              class="text-sm"
            >
              <td class="px-4 py-3">
                <img
                  v-if="item.imageUrlSmall"
                  :src="item.imageUrlSmall"
                  :alt="item.cardName"
                  class="h-14 w-10 rounded object-cover"
                >
                <div
                  v-else
                  class="flex h-14 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
                >
                  —
                </div>
              </td>
              <td class="min-w-0 px-4 py-3">
                <div class="truncate font-medium text-gray-900">
                  {{ item.cardName }}
                </div>
                <div class="truncate text-xs text-gray-500">
                  {{ item.cardType }}<span v-if="item.setName"> · {{ item.setName }}</span>
                </div>
              </td>
              <td class="px-4 py-3 uppercase text-gray-700">
                {{ item.language }}
              </td>
              <td class="px-4 py-3 text-gray-700">
                {{ editionLabels[item.edition] ?? item.edition }}
              </td>
              <td class="px-4 py-3 text-gray-700">
                {{ conditionLabels[item.condition] ?? item.condition }}
              </td>
              <td class="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                ×{{ item.quantity }}
              </td>
              <td class="px-4 py-3">
                <USelect
                  :model-value="item.collectionId ?? noAssignmentValue"
                  :items="assignItems"
                  :aria-label="`Sammlung für ${item.cardName}`"
                  @update:model-value="(value: string) => assignToCollection(item, value)"
                />
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    aria-label="Karte bearbeiten"
                    @click="openEdit(item)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    aria-label="Karte entfernen"
                    @click="removeItem(item)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="total > pageSize"
        class="flex justify-end"
      >
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          :page-count="pageCount"
        />
      </div>
    </div>

    <UModal
      v-model:open="isPickerOpen"
      title="Karte aus dem Katalog wählen"
    >
      <template #body>
        <InventoryCatalogCardPicker @select="openAdd" />
      </template>
    </UModal>

    <InventoryAddToInventoryModal
      v-model:open="isEntryOpen"
      :card="selectedCard"
      :collections="collectionOptions"
      :preset-collection-id="collectionId ?? null"
      :initial-values="editingItem && {
        id: editingItem.id,
        catalogCardId: editingItem.catalogCardId,
        printingId: editingItem.printingId,
        collectionId: editingItem.collectionId,
        quantity: editingItem.quantity,
        language: editingItem.language,
        condition: editingItem.condition,
        edition: editingItem.edition,
        note: editingItem.note,
      }"
      @saved="onSaved"
    />
  </div>
</template>
