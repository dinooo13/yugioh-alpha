<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import { UNASSIGNED_COLLECTION_ID } from '~~/shared/inventory'
import type { InventorySearchFilters } from '~/components/inventory/InventorySearchPanel.vue'
import type { CardDetailPreview } from '~/utils/card-detail'
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
  cardAttribute: string | null
  cardTextExcerpt: string | null
  cardTextExcerptDe?: string | null
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
const count = useCount()

const route = useRoute()
const router = useRouter()
const page = ref(1)
const pageSize = 20
const isPickerOpen = ref(false)
const isEntryOpen = ref(false)
const selectedCard = ref<CatalogCard | null>(null)

// The URL is the single source of truth for the page's scope and view, so
// deep links, reloads and Back/Forward all restore them:
// - `?collectionId=` — a collection id or `__none__` (cards without one);
//   absent = all cards. Drives both views, the header and the presets.
// - `?view=gallery` — "Galerie"; absent = "Liste" (`list`). The former
//   `view=overview` ("Übersicht", before #135) is still accepted and
//   rewritten on load.
// Defaults are never written, so the plain page stays at `/inventory`.
// (The former `?card=` list filter is gone with #135: the detail panel
// edits a card's rows. A leftover one is dropped on load.)
// Patches build on the one still being navigated to, so two in a row (e.g.
// on load: a stale collection and the old view value) don't undo each other.
let pendingQuery: LocationQueryRaw | null = null
function setQuery(patch: LocationQueryRaw) {
  const query = { ...(pendingQuery ?? route.query), ...patch }
  pendingQuery = query
  return router.replace({ query }).finally(() => {
    if (pendingQuery === query) {
      pendingQuery = null
    }
  })
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

const mode = computed<'list' | 'gallery'>({
  get: () => route.query.view === 'gallery' || route.query.view === 'overview' ? 'gallery' : 'list',
  set: (value) => {
    setQuery({ view: value === 'gallery' ? 'gallery' : undefined })
  },
})

// Old links: `view=overview` → `view=gallery`, and no `card` any more.
onMounted(() => {
  if (route.query.view === 'overview' || route.query.card !== undefined) {
    setQuery({ view: route.query.view === 'overview' ? 'gallery' : route.query.view ?? undefined, card: undefined })
  }
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

// A "Liste" row's collection as text; hidden when the page is scoped to one
// collection (or to none) anyway.
function rowCollectionLabel(item: InventoryItem): string {
  if (!item.collectionId) {
    return t('inventory.breakdown.noCollection')
  }
  return collectionOptions.value.find(c => c.id === item.collectionId)?.name ?? t('inventory.breakdown.unnamedCollection')
}

// Any filter or scope change resets both views back to page 1.
watch([debouncedQ, collectionId], () => {
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

// Whether any of the panel's facets is set — they only affect "Galerie".
const hasActiveFacets = computed(() => Boolean(
  filters.value.type.length
  || filters.value.attribute.length
  || filters.value.race.length
  || filters.value.level.length,
))

// Search text or facets (not the collection, which is the page's scope).
const hasActiveSearchFilters = computed(() => Boolean(filters.value.q) || hasActiveFacets.value)

// Same, but including the collection scope — used for the Galerie empty
// state ("leer" vs. "keine Treffer").
const hasAnyFilter = computed(() => hasActiveSearchFilters.value || Boolean(collectionId.value))

// The moment the user actually starts searching/filtering, default to the
// aggregated "Galerie" view (the toggle still lets them switch back).
// Selecting a collection never switches the view.
watch(hasActiveSearchFilters, (active, wasActive) => {
  if (active && !wasActive && mode.value === 'list') {
    mode.value = 'gallery'
  }
})

const searchPageSize = 24
// Note: in "Galerie" a collection keeps every card with at least one copy
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
  isPickerOpen.value = false
  isEntryOpen.value = true
}

async function refreshAll() {
  await Promise.all([refresh(), refreshCollections(), refreshSearch(), refreshFacets()])
}

// After each write in the detail panel: one refresh of everything behind it
// once a burst of edits ("+ + +") has settled.
let refreshTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    refreshAll()
  }, 150)
}
onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
  clearTimeout(qTimeout)
})

// The card detail panel (#88, #135): the same overlay with the same editor
// from a "Galerie" tile and from a "Liste" row. It always shows all the
// card's rows; from a row, that row is highlighted.
const detail = ref<{ cardId: number, preview: CardDetailPreview, focusRowId: string | null } | null>(null)
const isDetailOpen = ref(false)

function openFromGallery(item: SearchResultItem) {
  detail.value = { cardId: item.catalogCardId, preview: item, focusRowId: null }
  isDetailOpen.value = true
}

function openFromList(item: InventoryItem) {
  detail.value = {
    cardId: item.catalogCardId,
    preview: {
      name: item.cardName,
      nameDe: item.cardNameDe,
      type: item.cardType,
      attribute: item.cardAttribute,
      level: null,
      atk: null,
      def: null,
      imageSmall: item.imageUrlSmall,
    },
    focusRowId: item.id,
  }
  isDetailOpen.value = true
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
            :label="t('inventory.view.gallery')"
            :color="mode === 'gallery' ? 'primary' : 'neutral'"
            :variant="mode === 'gallery' ? 'subtle' : 'outline'"
            :aria-pressed="mode === 'gallery'"
            @click="() => { mode = 'gallery' }"
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
      {{ t('inventory.search.facetsGalleryOnly') }}
    </p>

    <!-- Galerie: aggregated, faceted inventory-wide search -->
    <div
      v-if="mode === 'gallery'"
      class="space-y-4"
    >
      <p class="text-sm text-muted">
        {{ count('inventory.cardCount', searchTotal) }}
      </p>

      <!-- Skeletons only before there is anything to show: a refresh after
           an edit in the detail panel keeps the tiles (and so the tile the
           panel returns focus to). -->
      <div
        v-if="searchPending && searchItems.length === 0"
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
          :title="t('inventory.gallery.loadFailed')"
          :description="t('inventory.gallery.tryAgain')"
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
          :title="t('inventory.gallery.empty')"
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
          :title="t('inventory.gallery.noMatches')"
          :description="t('inventory.gallery.noMatchesDescription')"
          :bordered="false"
        />
      </div>

      <div
        v-else
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
        :aria-busy="searchPending || undefined"
      >
        <InventoryCardTile
          v-for="result in searchItems"
          :key="result.catalogCardId"
          :item="result"
          @open="openFromGallery(result)"
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

    <!-- Liste: one row per card and collection, for reading; a row opens
         the card's detail panel. -->
    <div
      v-else
      class="space-y-4"
    >
      <div class="panel overflow-hidden">
        <ul
          v-if="pending && items.length === 0"
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
          v-else-if="items.length === 0 && debouncedQ"
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
          :aria-busy="pending || undefined"
        >
          <InventoryListRow
            v-for="item in items"
            :key="item.id"
            :item="item"
            :collection-label="rowCollectionLabel(item)"
            :show-collection="!collectionId"
            @open="openFromList(item)"
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
      @saved="refreshAll"
    />

    <CardDetailModal
      v-model:open="isDetailOpen"
      :card-id="detail?.cardId ?? null"
      :preview="detail?.preview ?? null"
      variant="inventory"
    >
      <template #context>
        <InventoryOwnedCardEditor
          v-if="detail"
          :key="detail.cardId"
          :catalog-card-id="detail.cardId"
          :card-label="cardName(detail.preview)"
          :collections="collectionOptions"
          :focus-row-id="detail.focusRowId"
          :after-write="scheduleRefresh"
        />
      </template>
      <template #actions>
        <UButton
          v-if="detail"
          :to="`/catalog?card=${detail.cardId}`"
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
