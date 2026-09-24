<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import { UNASSIGNED_COLLECTION_ID } from '~~/shared/inventory'
import type { InventorySearchFilters } from '~/components/inventory/InventorySearchPanel.vue'
import type { InventorySearchResultItem } from '~/utils/inventory-search-result'

interface InventoryItem {
  id: string
  catalogCardId: number
  collectionId: string | null
  quantity: number
  note: string | null
  cardName: string
  cardNameDe?: string | null
  cardType: string
  cardRetired?: boolean
  imageUrlSmall: string | null
}

interface CatalogCard {
  id: number
  name: string
  nameDe?: string | null
  type: string
  imageUrlSmall?: string | null
}

interface SearchFilters extends InventorySearchFilters {
  q: string
  inText: boolean
  page: number
}

type SearchResultItem = InventorySearchResultItem

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
}

function emptyFacets(): SearchFacets {
  return {
    types: [],
    attributes: [],
    races: [],
    levels: [],
  }
}

usePageTitle('inventory.title')

const { t } = useI18n()
const { cardName } = useCardText()
// A "Liste" row in the card language (ADR 0015).
const listItemName = (item: InventoryItem) => cardName({ name: item.cardName, nameDe: item.cardNameDe })
const count = useCount()
const apiError = useApiError()

const route = useRoute()
const router = useRouter()
const page = ref(1)
const pageSize = 20
const isPickerOpen = ref(false)
const isEntryOpen = ref(false)
const selectedCard = ref<CatalogCard | null>(null)
const editingItem = ref<InventoryItem | null>(null)
const errorMessage = ref('')

// The URL is the single source of truth for the page's scope and view, so
// deep links, reloads and Back/Forward all restore them:
// - `?collectionId=` — a collection id or `__none__` (cards without one);
//   absent = all cards. Drives both views, the header and the presets.
// - `?view=overview` — absent = "Liste" (`list`).
// - `?card=` — "Liste" only: the rows of one catalog card ("In Liste
//   bearbeiten" from the Übersicht preview).
// Defaults are never written, so the plain page stays at `/inventory`.
function setQuery(patch: LocationQueryRaw, { push = false } = {}) {
  const query = { ...route.query, ...patch }
  return push ? router.push({ query }) : router.replace({ query })
}

const collectionId = computed({
  get: () => {
    const value = route.query.collectionId
    return typeof value === 'string' ? value : ''
  },
  set: (value: string) => {
    setQuery({ collectionId: value || undefined })
  },
})

const mode = computed<'list' | 'overview'>({
  get: () => route.query.view === 'overview' ? 'overview' : 'list',
  set: (value) => {
    // The card filter only exists in "Liste"; leaving it drops the filter.
    setQuery(value === 'overview' ? { view: 'overview', card: undefined } : { view: undefined })
  },
})

const cardFilter = computed(() => {
  const raw = route.query.card
  const id = typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : undefined
})

const filters = ref<SearchFilters>({
  q: '',
  inText: false,
  type: [],
  attribute: [],
  race: [],
  level: [],
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

const listQuery = computed(() => ({
  q: debouncedQ.value || undefined,
  page: page.value,
  pageSize,
  collectionId: collectionId.value || undefined,
  catalogCardId: cardFilter.value,
}))

const { data, pending, refresh } = await useFetch<{ items: InventoryItem[], total: number }>('/api/inventory', {
  query: listQuery,
  default: () => ({ items: [], total: 0 }),
  watch: [listQuery],
})

const items = computed(() => data.value.items)
const total = computed(() => data.value.total)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

// Shared (same `useCollections` key) with the collection menu, the add modal
// and the dashboard, so one refresh after creating a collection or assigning
// a card updates all of them (UX review #4).
const {
  data: collectionsResponse,
  refresh: refreshCollections,
  status: collectionsStatus,
} = await useCollections()
const collectionOptions = computed(() => collectionsResponse.value.items)
const allCardsCount = computed(() => collectionsResponse.value.allCount ?? 0)
// Both counts sum quantities, so the difference is the copies without one.
const unassignedCount = computed(() => Math.max(
  0,
  allCardsCount.value - collectionOptions.value.reduce((sum, c) => sum + c.cardCount, 0),
))

const isUnassigned = computed(() => collectionId.value === UNASSIGNED_COLLECTION_ID)
const activeCollection = computed(() => collectionOptions.value.find(c => c.id === collectionId.value) ?? null)
const headerTitle = computed(() => activeCollection.value?.name ?? (isUnassigned.value ? t('inventory.scope.unassigned') : t('inventory.scope.all')))
const headerCount = computed(() => {
  if (activeCollection.value) {
    return activeCollection.value.cardCount
  }
  return isUnassigned.value ? unassignedCount.value : allCardsCount.value
})

// A stale `?collectionId=` (deleted elsewhere, or a foreign id) falls back to
// all cards once the collection list is known.
function dropStaleCollection() {
  const id = collectionId.value
  if (
    id
    && id !== UNASSIGNED_COLLECTION_ID
    && collectionsStatus?.value === 'success'
    && !collectionOptions.value.some(c => c.id === id)
  ) {
    setQuery({ collectionId: undefined })
  }
}
onMounted(dropStaleCollection)
watch([collectionId, collectionOptions, () => collectionsStatus?.value], dropStaleCollection)

function onCollectionsChanged() {
  refreshCollections()
}

async function onCollectionDeleted() {
  await Promise.all([refresh(), refreshCollections(), refreshSearch()])
}

const noAssignmentValue = '__no_collection__'
const assignItems = computed(() => [
  { label: t('inventory.noCollectionOption'), value: noAssignmentValue },
  ...collectionOptions.value.map(c => ({ label: c.name, value: c.id })),
])

async function assignToCollection(item: InventoryItem, value: string) {
  errorMessage.value = ''
  try {
    await $fetch(`/api/inventory/${item.id}`, {
      method: 'PATCH',
      body: { collectionId: value === noAssignmentValue ? null : value },
    })
    await Promise.all([refresh(), refreshCollections(), refreshSearch()])
  }
  catch (error) {
    errorMessage.value = apiError(error, 'inventory.errors.assignFailed')
  }
}

// Any filter or scope change resets both views back to page 1.
watch([debouncedQ, collectionId, cardFilter], () => {
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
    filters.value.sort,
  ],
  () => {
    filters.value.page = 1
  },
  { deep: true },
)

// Whether any of the panel's facets is set — they only affect "Übersicht".
const hasActiveFacets = computed(() => Boolean(
  filters.value.type.length
  || filters.value.attribute.length
  || filters.value.race.length
  || filters.value.level.length,
))

// Search text or facets (not the collection, which is the page's scope).
const hasActiveSearchFilters = computed(() => Boolean(filters.value.q) || hasActiveFacets.value)

// Same, but including the collection scope — used for the Übersicht empty
// state ("leer" vs. "keine Treffer").
const hasAnyFilter = computed(() => hasActiveSearchFilters.value || Boolean(collectionId.value))

// The moment the user actually starts searching/filtering, default to the
// aggregated "Übersicht" view (the toggle still lets them switch back) —
// except while "Liste" shows one card's rows ("In Liste bearbeiten"), where
// typing a search replaces the card filter instead (below). Selecting a
// collection never switches the view.
watch(hasActiveSearchFilters, (active, wasActive) => {
  if (active && !wasActive && !cardFilter.value && mode.value === 'list') {
    mode.value = 'overview'
  }
})
watch(debouncedQ, (value) => {
  if (value && cardFilter.value) {
    setQuery({ card: undefined })
  }
})

const searchPageSize = 24
// Note: in "Übersicht" a collection keeps every card with at least one copy
// in it, and the totals/breakdown still span all collections — "Liste"
// filters row by row (see server/utils/inventory-search.ts vs. inventory.ts).
const searchQuery = computed(() => ({
  q: debouncedQ.value || undefined,
  inText: filters.value.inText ? 1 : undefined,
  type: filters.value.type.length ? filters.value.type.join(',') : undefined,
  attribute: filters.value.attribute.length ? filters.value.attribute.join(',') : undefined,
  race: filters.value.race.length ? filters.value.race.join(',') : undefined,
  level: filters.value.level.length ? filters.value.level.join(',') : undefined,
  collectionId: collectionId.value || undefined,
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
    nameDe: item.cardNameDe ?? null,
    type: item.cardType,
    imageUrlSmall: item.imageUrlSmall,
  }
  editingItem.value = item
  isEntryOpen.value = true
}

const { confirm } = useConfirm()

async function removeItem(item: InventoryItem) {
  errorMessage.value = ''
  const confirmed = await confirm({
    title: t('inventory.confirm.remove.title'),
    description: t('inventory.confirm.remove.description', { name: listItemName(item) }),
  })
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/inventory/${item.id}`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshCollections(), refreshSearch(), refreshFacets()])
  }
  catch (error) {
    errorMessage.value = apiError(error, 'inventory.errors.removeFailed')
  }
}

// "Übersicht": clicking a tile's artwork opens the card detail overlay (#88).
const previewItem = ref<SearchResultItem | null>(null)
const isPreviewOpen = ref(false)

function openPreview(item: SearchResultItem) {
  previewItem.value = item
  isPreviewOpen.value = true
}

// Name for the "Nur: …" chip, remembered from the preview so it shows before
// the filtered list has loaded.
const cardFilterSource = ref<{ id: number, name: string, nameDe?: string | null } | null>(null)
const cardFilterName = computed(() => {
  if (cardFilterSource.value && cardFilterSource.value.id === cardFilter.value) {
    return cardName(cardFilterSource.value)
  }
  const first = items.value[0]
  return first ? listItemName(first) : t('inventory.cardFilter.fallbackName')
})

// "In Liste bearbeiten": show this card's individual rows in "Liste".
// Filters by catalog id rather than by name, so "Dark Magician" doesn't also
// match "Dark Magician Girl". The collection scope is dropped because the
// preview's breakdown spans every collection. A push (not a replace), so
// Back returns to the Übersicht.
async function editInList(item: SearchResultItem) {
  isPreviewOpen.value = false
  // Clear the search text right away (no debounce) — the list must not be
  // narrowed by a leftover name search, and a later non-empty search would
  // drop the card filter again.
  if (qTimeout) {
    clearTimeout(qTimeout)
  }
  filters.value.q = ''
  debouncedQ.value = ''
  cardFilterSource.value = { id: item.catalogCardId, name: item.name, nameDe: item.nameDe }
  await setQuery({ view: undefined, collectionId: undefined, card: String(item.catalogCardId) }, { push: true })
}

function clearCardFilter() {
  setQuery({ card: undefined })
}

async function onSaved() {
  await Promise.all([refresh(), refreshCollections(), refreshSearch(), refreshFacets()])
}
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      :title="headerTitle"
      truncate
    >
      <template #description>
        <span class="inline-flex flex-wrap items-center gap-2">
          {{ count('inventory.cardCount', headerCount) }}
          <SharingVisibilityBadge
            v-if="activeCollection"
            :visibility="activeCollection.visibility"
            hide-private
          />
        </span>
      </template>

      <template #actions>
        <UButton
          :to="{ path: '/inventory/quick-entry', query: activeCollection ? { collectionId: activeCollection.id } : undefined }"
          icon="i-lucide-zap"
          color="neutral"
          variant="outline"
          :label="t('inventory.actions.quickEntry')"
        />
        <UButton
          icon="i-lucide-plus"
          :label="t('inventory.actions.addCard')"
          @click="() => { isPickerOpen = true }"
        />
      </template>
    </LayoutPageHeader>

    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <CollectionsCollectionActions
          v-model="collectionId"
          :collections="collectionOptions"
          :all-count="allCardsCount"
          :unassigned-count="unassignedCount"
          @changed="onCollectionsChanged"
          @deleted="onCollectionDeleted"
        />

        <UFieldGroup>
          <UButton
            :label="t('inventory.view.list')"
            :color="mode === 'list' ? 'primary' : 'neutral'"
            :variant="mode === 'list' ? 'subtle' : 'outline'"
            :aria-pressed="mode === 'list'"
            @click="() => { mode = 'list' }"
          />
          <UButton
            :label="t('inventory.view.overview')"
            :color="mode === 'overview' ? 'primary' : 'neutral'"
            :variant="mode === 'overview' ? 'subtle' : 'outline'"
            :aria-pressed="mode === 'overview'"
            @click="() => { mode = 'overview' }"
          />
        </UFieldGroup>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UInput
          v-model="filters.q"
          icon="i-lucide-search"
          :placeholder="t('inventory.search.placeholder')"
          :aria-label="t('inventory.search.label')"
          class="w-full max-w-xl"
        />
        <UCheckbox
          v-model="filters.inText"
          :label="t('inventory.search.inText')"
        />
      </div>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>

    <!-- Filterleiste ist modusunabhängig sichtbar (UX review #16) — vorher
         verschwand sie kommentarlos beim Wechsel auf "Liste". -->
    <InventorySearchPanel
      v-model:filters="filters"
      :facets="facets"
    />
    <p
      v-if="mode === 'list' && hasActiveFacets"
      class="text-xs text-muted"
    >
      {{ t('inventory.search.facetsOverviewOnly') }}
    </p>

    <!-- Übersicht: aggregated, faceted inventory-wide search -->
    <div
      v-if="mode === 'overview'"
      class="space-y-4"
    >
      <p class="text-sm text-muted">
        {{ count('inventory.cardCount', searchTotal) }}
      </p>

      <div
        v-if="searchPending"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
      >
        <USkeleton
          v-for="n in 12"
          :key="n"
          class="aspect-[59/86] rounded-lg"
        />
      </div>

      <div
        v-else-if="searchError || searchItems.length === 0"
        class="panel overflow-hidden"
      >
        <UAlert
          v-if="searchError"
          color="error"
          variant="subtle"
          :title="t('inventory.overview.loadFailed')"
          :description="t('inventory.overview.tryAgain')"
          class="m-4"
        >
          <template #actions>
            <UButton
              icon="i-lucide-refresh-cw"
              :label="t('common.retry')"
              color="error"
              variant="outline"
              @click="() => refreshSearch()"
            />
          </template>
        </UAlert>

        <LayoutEmptyState
          v-else-if="!hasAnyFilter"
          icon="i-lucide-archive"
          :title="t('inventory.overview.empty')"
          :description="t('inventory.emptyDescription')"
          :bordered="false"
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              :label="t('inventory.actions.addCard')"
              @click="() => { isPickerOpen = true }"
            />
          </template>
        </LayoutEmptyState>

        <LayoutEmptyState
          v-else
          icon="i-lucide-search-x"
          :title="t('inventory.overview.noMatches')"
          :description="t('inventory.overview.noMatchesDescription')"
          :bordered="false"
        />
      </div>

      <div
        v-else
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
      >
        <InventoryCardTile
          v-for="result in searchItems"
          :key="result.catalogCardId"
          :item="result"
          @preview="openPreview(result)"
        />
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
      <div
        v-if="cardFilter"
        class="flex items-center gap-1"
      >
        <UBadge
          color="neutral"
          variant="subtle"
          size="lg"
          icon="i-lucide-filter"
          :label="t('inventory.cardFilter.label', { name: cardFilterName })"
          class="max-w-full truncate"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="tap-target"
          :aria-label="t('inventory.cardFilter.clear')"
          @click="clearCardFilter"
        />
      </div>

      <div class="panel overflow-hidden">
        <ul
          v-if="pending"
          class="divide-y divide-default"
          aria-busy="true"
          :aria-label="t('inventory.list.loading')"
        >
          <li
            v-for="n in 5"
            :key="n"
            class="flex items-center gap-3 px-4 py-3"
          >
            <USkeleton class="aspect-[59/86] w-16 shrink-0 rounded sm:w-12" />
            <div class="flex-1 space-y-2">
              <USkeleton class="h-4 w-1/2" />
              <USkeleton class="h-3 w-1/3" />
            </div>
          </li>
        </ul>

        <LayoutEmptyState
          v-else-if="items.length === 0 && (cardFilter || debouncedQ)"
          icon="i-lucide-search-x"
          :title="t('inventory.list.noMatches')"
          :description="t('inventory.list.noMatchesDescription')"
          :bordered="false"
        />

        <LayoutEmptyState
          v-else-if="items.length === 0 && isUnassigned"
          icon="i-lucide-archive"
          :title="t('inventory.list.noUnassigned')"
          :description="t('inventory.list.noUnassignedDescription')"
          :bordered="false"
        />

        <LayoutEmptyState
          v-else-if="items.length === 0"
          icon="i-lucide-archive"
          :title="collectionId ? t('inventory.list.emptyCollection') : t('inventory.list.empty')"
          :description="t('inventory.emptyDescription')"
          :bordered="false"
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              :label="t('inventory.actions.addCard')"
              @click="() => { isPickerOpen = true }"
            />
          </template>
        </LayoutEmptyState>

        <ul
          v-else
          class="divide-y divide-default"
        >
          <InventoryListRow
            v-for="item in items"
            :key="item.id"
            :item="item"
            :assign-items="assignItems"
            :no-assignment-value="noAssignmentValue"
            @assign="(value: string) => assignToCollection(item, value)"
            @edit="openEdit(item)"
            @remove="removeItem(item)"
          />
        </ul>
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
      :title="t('inventory.picker.title')"
    >
      <template #body>
        <InventoryCatalogCardPicker @select="openAdd" />
      </template>
    </UModal>

    <InventoryAddToInventoryModal
      v-model:open="isEntryOpen"
      :card="selectedCard"
      :collections="collectionOptions"
      :preset-collection-id="activeCollection?.id ?? null"
      :initial-values="editingItem && {
        id: editingItem.id,
        catalogCardId: editingItem.catalogCardId,
        collectionId: editingItem.collectionId,
        quantity: editingItem.quantity,
        note: editingItem.note,
      }"
      @saved="onSaved"
    />

    <CardDetailModal
      v-model:open="isPreviewOpen"
      :card-id="previewItem?.catalogCardId ?? null"
      :preview="previewItem"
      variant="inventory"
    >
      <template #context>
        <InventoryOwnedCardSummary
          v-if="previewItem"
          :item="previewItem"
        />
      </template>
      <template #actions>
        <UButton
          v-if="previewItem"
          icon="i-lucide-list"
          :label="t('inventory.preview.editInList')"
          color="neutral"
          variant="outline"
          class="tap-target"
          @click="editInList(previewItem)"
        />
        <UButton
          v-if="previewItem"
          :to="`/catalog?card=${previewItem.catalogCardId}`"
          icon="i-lucide-book-open"
          :label="t('inventory.preview.openInCatalog')"
          color="neutral"
          variant="outline"
          class="tap-target"
        />
      </template>
    </CardDetailModal>
  </div>
</template>
