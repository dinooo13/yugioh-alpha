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

useHead({ title: 'Katalog - yugioh alpha' })

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
const primaryImage = computed(() => detail.value?.images[0]?.imageUrl ?? detail.value?.images[0]?.imageUrlSmall ?? null)

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
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-4">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Katalog
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-gray-500">
          Durchsuche den globalen Kartenkatalog nach Name, Typ, Attribut, Monsterart, Level und Set.
        </p>
      </div>

      <section class="space-y-3 border-y border-gray-200 py-4">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(10rem,12rem))]">
          <UInput
            v-model="searchInput"
            icon="i-lucide-search"
            placeholder="Karten suchen..."
            aria-label="Karten suchen"
            class="min-w-0"
          />

          <select
            v-model="type"
            aria-label="Typ"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              Typ
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
            aria-label="Attribut"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              Attribut
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
            aria-label="Level"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              Level
            </option>
            <option
              v-for="option in facets.levels"
              :key="option"
              :value="String(option)"
            >
              Level {{ option }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_auto]">
          <select
            v-model="race"
            aria-label="Monsterart"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              Monsterart
            </option>
            <option
              v-for="option in facets.races"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>

          <select
            v-model="setId"
            aria-label="Set"
            class="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">
              Set
            </option>
            <option
              v-for="option in facets.sets"
              :key="option.id"
              :value="option.id"
            >
              {{ option.name }}
            </option>
          </select>

          <UButton
            icon="i-lucide-rotate-ccw"
            label="Zurücksetzen"
            color="neutral"
            variant="outline"
            class="min-w-0 justify-center"
            @click="resetFilters"
          />
        </div>
      </section>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm font-medium text-gray-700">
        {{ cards.total.toLocaleString('de-DE') }} Karten
      </p>

      <label class="flex items-center gap-2 text-sm text-gray-600">
        Sortierung
        <select
          v-model="sort"
          class="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="name">
            Name A-Z
          </option>
          <option value="-name">
            Name Z-A
          </option>
          <option value="newest">
            Neueste zuerst
          </option>
        </select>
      </label>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      title="Katalog konnte nicht geladen werden"
      :description="String(error.message ?? error)"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          label="Erneut laden"
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

    <section
      v-else-if="cards.total === 0"
      class="border-y border-dashed border-gray-300 py-12 text-center"
    >
      <h2 class="text-base font-semibold text-gray-900">
        {{ filtersActive ? 'Keine Karten gefunden' : 'Noch kein Katalog importiert' }}
      </h2>
      <p class="mx-auto mt-2 max-w-xl text-sm text-gray-500">
        {{ filtersActive
          ? 'Passe Suche oder Filter an, um mehr Treffer zu sehen.'
          : 'Starte zuerst den Katalog-Sync, damit Karten hier durchsucht und gefiltert werden können.' }}
      </p>
    </section>

    <section
      v-else
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      <button
        v-for="card in cards.items"
        :key="card.id"
        type="button"
        class="group min-w-0 overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        @click="openCard(card.id)"
      >
        <div class="aspect-[3/4.35] bg-gray-100">
          <img
            v-if="card.imageSmall"
            :src="card.imageSmall"
            :alt="card.name"
            loading="lazy"
            class="h-full w-full object-cover"
          >
          <div
            v-else
            class="flex h-full items-center justify-center px-3 text-center text-xs text-gray-400"
          >
            Kein Bild
          </div>
        </div>
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
              Lv {{ card.level }}
            </UBadge>
          </div>
        </div>
      </button>
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

    <USlideover
      :open="isDetailOpen"
      @update:open="value => { if (!value) closeCard() }"
    >
      <template #content>
        <div class="h-full overflow-y-auto p-6">
          <div class="mb-5 flex items-center justify-between gap-3">
            <h2 class="truncate text-lg font-semibold text-gray-900">
              {{ detail?.card.name ?? 'Karte' }}
            </h2>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              aria-label="Schließen"
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
            title="Karte nicht gefunden"
            description="Der Detaildatensatz konnte nicht geladen werden."
          />

          <article
            v-else-if="detail"
            class="space-y-6"
          >
            <img
              v-if="primaryImage"
              :src="primaryImage"
              :alt="detail.card.name"
              class="mx-auto w-full max-w-xs rounded-md border border-gray-200"
            >

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
                  · Level {{ detail.card.level }}
                </template>
              </p>
              <p
                v-if="detail.card.atk !== null || detail.card.def !== null"
                class="text-sm text-gray-600"
              >
                ATK {{ detail.card.atk ?? '-' }} / DEF {{ detail.card.def ?? '-' }}
              </p>
            </div>

            <section>
              <h4 class="text-sm font-semibold text-gray-900">
                Kartentext
              </h4>
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-gray-700">
                {{ detail.card.desc }}
              </p>
            </section>

            <section v-if="detail.printings.length > 0">
              <h4 class="text-sm font-semibold text-gray-900">
                Printings
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
  </div>
</template>
