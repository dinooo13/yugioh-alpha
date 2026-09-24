<script setup lang="ts">
interface CatalogFacets {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  sets: Array<{ id: string, name: string }>
}

interface CatalogCardSummary {
  id: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
}

interface CatalogSearchResponse {
  items: CatalogCardSummary[]
  total: number
  page: number
  pageSize: number
}

interface CatalogCardDetail {
  card: {
    id: number
    name: string
    type: string
    frameType: string | null
    desc: string
    race: string | null
    archetype: string | null
    attribute: string | null
    atk: number | null
    def: number | null
    level: number | null
    linkval: number | null
    scale: number | null
    linkMarkers: string[] | null
    banlistInfo: Record<string, string> | null
    cardPrices: Record<string, string> | null
    tcgDate: string | null
    ocgDate: string | null
    ygoprodeckUrl: string | null
  }
  printings: Array<{
    setCode: string
    setName: string
    rarity: string | null
    price: string | null
  }>
  images: Array<{
    id: number
    imageUrl: string
    imageUrlSmall: string | null
    imageUrlCropped: string | null
  }>
}

const PAGE_SIZE = 24

usePageTitle('catalog.title')

const { t } = useI18n()
const count = useCount()

const route = useRoute()
const router = useRouter()

const searchInput = ref(typeof route.query.q === 'string' ? route.query.q : '')
const debouncedSearch = ref(searchInput.value)
const type = ref(typeof route.query.type === 'string' ? route.query.type : '')
const attribute = ref(typeof route.query.attribute === 'string' ? route.query.attribute : '')
const race = ref(typeof route.query.race === 'string' ? route.query.race : '')
const level = ref(typeof route.query.level === 'string' ? route.query.level : '')
const setId = ref(typeof route.query.setId === 'string' ? route.query.setId : '')
const sort = ref(typeof route.query.sort === 'string' ? route.query.sort : 'name')
const page = ref(Number.parseInt(typeof route.query.page === 'string' ? route.query.page : '1', 10) || 1)
const selectedCardId = computed(() => Number.parseInt(typeof route.query.card === 'string' ? route.query.card : '', 10))
const isDetailOpen = computed(() => Number.isFinite(selectedCardId.value))

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = value
  }, 300)
})

const filtersActive = computed(() =>
  Boolean(debouncedSearch.value.trim() || type.value || attribute.value || race.value || level.value || setId.value),
)

const cardQuery = computed(() => ({
  q: debouncedSearch.value.trim() || undefined,
  type: type.value || undefined,
  attribute: attribute.value || undefined,
  race: race.value || undefined,
  level: level.value || undefined,
  setId: setId.value || undefined,
  sort: sort.value,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

const { data: facets } = await useFetch<CatalogFacets>('/api/catalog/facets', {
  default: () => ({ types: [], attributes: [], races: [], levels: [], sets: [] }),
})

// A plain `<select>` with 1000+ sets meant scrolling through an unsearchable
// list to find one (UX review #5) — `USelectMenu` is searchable by default,
// but reka-ui reserves the empty string for "clear selection", so "no set"
// uses a non-empty sentinel mapped back to `''` (matching the
// InventorySearchPanel convention).
const noSetValue = '__all_sets__'
const setItems = computed(() => [
  { label: t('catalog.filters.allSets'), value: noSetValue },
  ...facets.value.sets.map(set => ({ label: set.name, value: set.id })),
])
const setSelection = computed({
  get: () => setId.value || noSetValue,
  set: (value: string) => {
    setId.value = value === noSetValue ? '' : value
  },
})

// Seeds the "Zur Wunschliste" toggle state per card (Phase 6). A Set keeps the
// per-card lookup below cheap regardless of how many cards are on the page.
const { data: wishlistIds } = await useFetch<{ ids: number[] }>('/api/wishlist/ids', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ ids: [] }),
})
const wishlistedCardIds = ref<Set<number>>(new Set())
watch(wishlistIds, (value) => {
  wishlistedCardIds.value = new Set(value?.ids ?? [])
}, { immediate: true })

function isWishlisted(cardId: number) {
  return wishlistedCardIds.value.has(cardId)
}

function onWishlistChanged(cardId: number, inWishlist: boolean) {
  const next = new Set(wishlistedCardIds.value)
  if (inWishlist) {
    next.add(cardId)
  }
  else {
    next.delete(cardId)
  }
  wishlistedCardIds.value = next
}

const {
  data: cards,
  pending,
  error,
  refresh,
} = await useFetch<CatalogSearchResponse>('/api/catalog/cards', {
  query: cardQuery,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
})

const detail = ref<CatalogCardDetail | null>(null)
const detailPending = ref(false)
const detailError = ref<Error | null>(null)

watch([type, attribute, race, level, setId, sort, debouncedSearch], () => {
  page.value = 1
})

watch([debouncedSearch, type, attribute, race, level, setId, sort, page], async () => {
  await router.replace({
    query: {
      ...route.query,
      q: debouncedSearch.value.trim() || undefined,
      type: type.value || undefined,
      attribute: attribute.value || undefined,
      race: race.value || undefined,
      level: level.value || undefined,
      setId: setId.value || undefined,
      sort: sort.value === 'name' ? undefined : sort.value,
      page: page.value > 1 ? String(page.value) : undefined,
    },
  })
}, { flush: 'post' })

const totalPages = computed(() => Math.max(1, Math.ceil((cards.value?.total ?? 0) / PAGE_SIZE)))
// Locale-formatted and pluralized, so a one-hit search reads "1 Karte" and
// the full catalog "13.000 Karten" (UX review #10).
const cardsTotalLabel = computed(() => count('catalog.resultCount', cards.value.total))

watch(selectedCardId, async (cardId) => {
  detail.value = null
  detailError.value = null

  if (!Number.isFinite(cardId)) {
    return
  }

  detailPending.value = true
  try {
    detail.value = await $fetch<CatalogCardDetail>(`/api/catalog/cards/${cardId}`)
  }
  catch (error) {
    detailError.value = error instanceof Error ? error : new Error(String(error))
  }
  finally {
    detailPending.value = false
  }
}, { immediate: true })

function openCard(cardId: number) {
  router.replace({ query: { ...route.query, card: String(cardId) } })
}

function closeCard() {
  const query = { ...route.query }
  delete query.card
  router.replace({ query })
}

function resetFilters() {
  searchInput.value = ''
  debouncedSearch.value = ''
  type.value = ''
  attribute.value = ''
  race.value = ''
  level.value = ''
  setId.value = ''
  sort.value = 'name'
  page.value = 1
}

function previousPage() {
  page.value = Math.max(1, page.value - 1)
}

function nextPage() {
  page.value = Math.min(totalPages.value, page.value + 1)
}

async function reloadCards() {
  await refresh()
}

// "Zum Inventar" (UX review #6) reuses the same add-to-inventory modal as
// `/inventory`, pre-filled with the card the user clicked — no more detour of
// remembering the name and searching for it again on another page.
const { data: collectionsData, refresh: refreshCollectionsAfterAdd } = await useCollections()
const isAddToInventoryOpen = ref(false)
const addingCard = ref<CatalogCardSummary | null>(null)

function openAddToInventory(card: CatalogCardSummary) {
  addingCard.value = card
  isAddToInventoryOpen.value = true
}

async function onAddedToInventory() {
  await refreshCollectionsAfterAdd()
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-4">
      <LayoutPageHeader
        :title="t('catalog.title')"
        :description="t('catalog.description')"
      />

      <section class="space-y-3 border-y border-gray-200 py-4">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(10rem,12rem))]">
          <UInput
            v-model="searchInput"
            icon="i-lucide-search"
            :placeholder="t('catalog.search.placeholder')"
            :aria-label="t('catalog.search.label')"
            class="min-w-0"
          />

          <select
            v-model="type"
            :aria-label="t('catalog.filters.type')"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              {{ t('catalog.filters.type') }}
            </option>
            <option
              v-for="option in facets.types"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>

          <select
            v-model="attribute"
            :aria-label="t('catalog.filters.attribute')"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              {{ t('catalog.filters.attribute') }}
            </option>
            <option
              v-for="option in facets.attributes"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>

          <select
            v-model="level"
            :aria-label="t('catalog.filters.level')"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              {{ t('catalog.filters.level') }}
            </option>
            <option
              v-for="option in facets.levels"
              :key="option"
              :value="String(option)"
            >
              {{ t('card.level', { level: option }) }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_auto]">
          <select
            v-model="race"
            :aria-label="t('catalog.filters.race')"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              {{ t('catalog.filters.race') }}
            </option>
            <option
              v-for="option in facets.races"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>

          <USelectMenu
            v-model="setSelection"
            :items="setItems"
            value-key="value"
            :aria-label="t('catalog.filters.set')"
            :placeholder="t('catalog.filters.set')"
            class="min-w-0 w-full"
          />

          <UButton
            icon="i-lucide-rotate-ccw"
            :label="t('catalog.filters.reset')"
            color="neutral"
            variant="outline"
            class="min-w-0 justify-center"
            @click="resetFilters"
          />
        </div>
      </section>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm font-medium text-gray-700">
        {{ cardsTotalLabel }}
      </p>

      <label class="flex items-center gap-2 text-sm text-gray-600">
        {{ t('catalog.sort.label') }}
        <select
          v-model="sort"
          class="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="name">
            {{ t('catalog.sort.nameAsc') }}
          </option>
          <option value="-name">
            {{ t('catalog.sort.nameDesc') }}
          </option>
          <option value="newest">
            {{ t('catalog.sort.newest') }}
          </option>
        </select>
      </label>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      :title="t('catalog.loadFailed')"
      :description="t('catalog.tryAgain')"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          :label="t('catalog.reload')"
          color="error"
          variant="outline"
          @click="reloadCards"
        />
      </template>
    </UAlert>

    <div
      v-else-if="pending"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      <USkeleton
        v-for="index in 12"
        :key="index"
        class="aspect-[3/4.6] rounded-md"
      />
    </div>

    <LayoutEmptyState
      v-else-if="cards.total === 0"
      :icon="filtersActive ? 'i-lucide-search-x' : 'i-lucide-book-open'"
      :title="filtersActive ? t('catalog.empty.noMatches') : t('catalog.empty.noCatalog')"
      :description="filtersActive ? t('catalog.empty.noMatchesDescription') : t('catalog.empty.noCatalogDescription')"
    />

    <section
      v-else
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      <div
        v-for="card in cards.items"
        :key="card.id"
        role="button"
        tabindex="0"
        :aria-label="card.name"
        class="group min-w-0 cursor-pointer overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        @click="openCard(card.id)"
        @keydown.enter="openCard(card.id)"
        @keydown.space.prevent="openCard(card.id)"
      >
        <!-- Plain thumbnail: the whole tile is already the button. -->
        <CardThumb
          :src="card.imageSmall"
          :alt="card.name"
          size="full"
        />
        <div class="space-y-1 p-3">
          <h2 class="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-gray-900 group-hover:text-primary">
            {{ card.name }}
          </h2>
          <p class="truncate text-xs text-gray-500">
            {{ card.type }}
          </p>
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-if="card.attribute"
              size="sm"
              color="neutral"
              variant="soft"
            >
              {{ card.attribute }}
            </UBadge>
            <UBadge
              v-if="card.level"
              size="sm"
              color="neutral"
              variant="soft"
            >
              {{ t('card.levelShort', { level: card.level }) }}
            </UBadge>
          </div>
          <div class="flex flex-wrap gap-1">
            <UButton
              icon="i-lucide-archive-restore"
              color="primary"
              size="xs"
              :label="t('catalog.addToInventory')"
              class="tap-target"
              @click.stop="openAddToInventory(card)"
              @keydown.stop
            />
            <WishlistAddToWishlistButton
              :catalog-card-id="card.id"
              :in-wishlist="isWishlisted(card.id)"
              @click.stop
              @keydown.stop
              @changed="value => onWishlistChanged(card.id, value)"
            />
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="cards.total > PAGE_SIZE"
      class="flex items-center justify-center gap-2"
    >
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        :disabled="page <= 1"
        :aria-label="t('common.pagination.previous')"
        class="tap-target"
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
        class="tap-target"
        @click="nextPage"
      />
    </div>

    <USlideover
      :open="isDetailOpen"
      @update:open="value => { if (!value) closeCard() }"
    >
      <template #content>
        <div class="h-full overflow-y-auto p-6">
          <div class="mb-5 flex items-center justify-between gap-3">
            <h2 class="truncate text-lg font-semibold text-gray-900">
              {{ detail?.card.name ?? t('catalog.detail.fallbackTitle') }}
            </h2>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              :aria-label="t('common.close')"
              class="tap-target"
              @click="closeCard"
            />
          </div>

          <div
            v-if="detailPending"
            class="space-y-4"
          >
            <USkeleton class="aspect-[3/4.2] w-full rounded-md" />
            <USkeleton class="h-6 w-2/3" />
            <USkeleton class="h-24 w-full" />
          </div>

          <UAlert
            v-else-if="detailError"
            color="error"
            icon="i-lucide-circle-alert"
            :title="t('catalog.detail.notFound')"
            :description="t('catalog.detail.notFoundDescription')"
          />

          <article
            v-else-if="detail"
            class="space-y-6"
          >
            <CardThumb
              :src="detail.images[0]?.imageUrlSmall"
              :src-large="detail.images[0]?.imageUrl"
              :alt="detail.card.name"
              size="full"
              sizes="320px"
              loading="eager"
              class="mx-auto max-w-xs"
            />

            <div class="space-y-2">
              <h3 class="text-xl font-semibold text-gray-900">
                {{ detail.card.name }}
              </h3>
              <p class="text-sm text-gray-600">
                {{ detail.card.type }}
                <template v-if="detail.card.attribute">
                  · {{ detail.card.attribute }}
                </template>
                <template v-if="detail.card.level">
                  · {{ t('card.level', { level: detail.card.level }) }}
                </template>
              </p>
              <p
                v-if="detail.card.atk !== null || detail.card.def !== null"
                class="text-sm text-gray-600"
              >
                {{ t('card.atkDef', { atk: detail.card.atk ?? '-', def: detail.card.def ?? '-' }) }}
              </p>
            </div>

            <section>
              <h4 class="text-sm font-semibold text-gray-900">
                {{ t('catalog.detail.cardText') }}
              </h4>
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-gray-700">
                {{ detail.card.desc }}
              </p>
            </section>

            <section v-if="detail.printings.length > 0">
              <h4 class="text-sm font-semibold text-gray-900">
                {{ t('catalog.detail.printings') }}
              </h4>
              <ul class="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
                <li
                  v-for="printing in detail.printings"
                  :key="printing.setCode"
                  class="p-3 text-sm"
                >
                  <p class="font-medium text-gray-800">
                    {{ printing.setName }}
                  </p>
                  <p class="mt-1 text-gray-500">
                    {{ printing.setCode }}
                    <template v-if="printing.rarity">
                      · {{ printing.rarity }}
                    </template>
                  </p>
                </li>
              </ul>
            </section>

            <section class="grid grid-cols-2 gap-3 text-sm text-gray-600">
              <div v-if="detail.card.tcgDate">
                <span class="font-medium text-gray-900">TCG</span>
                <p>{{ detail.card.tcgDate }}</p>
              </div>
              <div v-if="detail.card.ocgDate">
                <span class="font-medium text-gray-900">OCG</span>
                <p>{{ detail.card.ocgDate }}</p>
              </div>
            </section>
          </article>
        </div>
      </template>
    </USlideover>

    <InventoryAddToInventoryModal
      v-model:open="isAddToInventoryOpen"
      :card="addingCard"
      :collections="collectionsData?.items ?? []"
      @saved="onAddedToInventory"
    />
  </div>
</template>
