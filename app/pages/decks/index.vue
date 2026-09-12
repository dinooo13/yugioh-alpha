<script setup lang="ts">
import type { OwnProfile, Visibility } from '~~/shared/sharing'

interface DeckListItem {
  id: string
  name: string
  description: string | null
  mainCount: number
  extraCount: number
  sideCount: number
  cardCount: number
  complete: boolean
  missingCount: number
  formatId: string | null
  formatName: string | null
  legal: boolean | null
  visibility: Visibility
  createdAt: string
  updatedAt: string
}

interface DeckListResponse {
  items: DeckListItem[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 20

useHead({ title: 'Decks – yugioh alpha' })

const searchInput = ref('')
const debouncedSearch = ref('')
const sort = ref<'updated' | 'name' | '-name' | 'newest'>('updated')
// reka-ui reserves the empty string for "clear selection", so "no filter" uses
// a sentinel that is dropped from the query.
const ALL_FORMATS = '__all_formats__'
const formatFilter = ref(ALL_FORMATS)
const page = ref(1)
const errorMessage = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = value.trim()
    page.value = 1
  }, 300)
})

watch([sort, formatFilter], () => {
  page.value = 1
})

const deckQuery = computed(() => ({
  q: debouncedSearch.value || undefined,
  sort: sort.value,
  formatId: formatFilter.value === ALL_FORMATS ? undefined : formatFilter.value,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

const { data, pending, refresh } = await useFetch<DeckListResponse>('/api/decks', {
  query: deckQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
  watch: [deckQuery],
})

const decks = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

const { data: formatsData } = await useFetch<{ items: Array<{ id: string, name: string, isBuiltin: boolean }> }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const formatFilterItems = computed(() => [
  { label: 'Alle Formate', value: ALL_FORMATS },
  { label: 'Ohne Format', value: 'none' },
  ...(formatsData.value?.items ?? []).map(format => ({ label: format.name, value: format.id })),
])

const sortItems = [
  { label: 'Zuletzt bearbeitet', value: 'updated' },
  { label: 'Neueste', value: 'newest' },
  { label: 'Name (A-Z)', value: 'name' },
  { label: 'Name (Z-A)', value: '-name' },
]

const { data: ownProfile } = await useFetch<OwnProfile>('/api/profile', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

const isFormOpen = ref(false)
const editingDeck = ref<DeckListItem | null>(null)

const isShareOpen = ref(false)
const sharingDeck = ref<DeckListItem | null>(null)
const sharePath = computed(() => `/spieler/${ownProfile.value?.handle ?? ''}/decks/${sharingDeck.value?.id ?? ''}`)

function openShare(deck: DeckListItem) {
  sharingDeck.value = deck
  isShareOpen.value = true
}

function onShareUpdated(visibility: Visibility) {
  if (!sharingDeck.value || !data.value) {
    return
  }
  const sharedId = sharingDeck.value.id
  data.value = {
    ...data.value,
    items: data.value.items.map(item => (item.id === sharedId ? { ...item, visibility } : item)),
  }
}

function openCreate() {
  editingDeck.value = null
  isFormOpen.value = true
}

function openRename(deck: DeckListItem) {
  editingDeck.value = deck
  isFormOpen.value = true
}

async function onSaved(deck: { id: string }, created: boolean) {
  if (created) {
    // Straight into the editor — a fresh deck is always empty.
    await navigateTo(`/decks/${deck.id}`)
    return
  }
  await refresh()
}

async function duplicateDeck(deck: DeckListItem) {
  errorMessage.value = ''
  try {
    await $fetch(`/api/decks/${deck.id}/duplicate`, { method: 'POST' })
    await refresh()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Das Deck konnte nicht dupliziert werden.'
  }
}

async function deleteDeck(deck: DeckListItem) {
  errorMessage.value = ''
  const confirmed = window.confirm(`"${deck.name}" wirklich löschen?`)
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/decks/${deck.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Das Deck konnte nicht gelöscht werden.'
  }
}

function menuItemsFor(deck: DeckListItem) {
  return [[
    {
      label: 'Bearbeiten',
      icon: 'i-lucide-pencil-ruler',
      onSelect: () => navigateTo(`/decks/${deck.id}`),
    },
    {
      label: 'Umbenennen',
      icon: 'i-lucide-pencil',
      onSelect: () => openRename(deck),
    },
    {
      label: 'Duplizieren',
      icon: 'i-lucide-copy',
      onSelect: () => duplicateDeck(deck),
    },
    {
      label: 'Teilen',
      icon: 'i-lucide-share-2',
      onSelect: () => openShare(deck),
    },
    {
      label: 'Löschen',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => deleteDeck(deck),
    },
  ]]
}

// An empty deck is neither complete nor missing anything — it is just empty.
function statusLabel(deck: DeckListItem) {
  if (deck.cardCount === 0) {
    return 'Leer'
  }
  if (deck.complete) {
    return 'Vollständig'
  }
  return deck.missingCount === 1 ? '1 fehlt' : `${deck.missingCount} fehlen`
}

function statusColor(deck: DeckListItem) {
  if (deck.cardCount === 0) {
    return 'neutral' as const
  }
  return deck.complete ? ('success' as const) : ('warning' as const)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Decks
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ total }} Deck<span v-if="total !== 1">s</span>
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          icon="i-lucide-sparkles"
          color="neutral"
          variant="outline"
          label="Mit KI erstellen"
          to="/decks/assistent"
        />
        <UButton
          icon="i-lucide-plus"
          label="Neues Deck"
          @click="openCreate"
        />
      </div>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="searchInput"
        icon="i-lucide-search"
        placeholder="Decks durchsuchen (Name oder Karte)..."
        aria-label="Decks durchsuchen"
        class="w-full max-w-xl"
      />
      <USelect
        v-model="sort"
        :items="sortItems"
        aria-label="Sortierung"
        class="w-52"
      />
      <USelect
        v-model="formatFilter"
        :items="formatFilterItems"
        aria-label="Format"
        class="w-52"
      />
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="pending"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-36 w-full"
      />
    </div>

    <div
      v-else-if="decks.length === 0 && !debouncedSearch"
      class="flex flex-col items-center rounded-md border border-gray-200 bg-white px-6 py-12 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <UIcon
          name="i-lucide-layers"
          class="size-6"
        />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-900">
        Noch keine Decks
      </h2>
      <p class="mt-1 max-w-sm text-sm text-gray-500">
        Lege dein erstes Deck an und fülle es mit Karten aus deinem Inventar.
      </p>
      <UButton
        icon="i-lucide-plus"
        label="Neues Deck"
        class="mt-4"
        @click="openCreate"
      />
    </div>

    <div
      v-else-if="decks.length === 0"
      class="flex flex-col items-center rounded-md border border-gray-200 bg-white px-6 py-12 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <UIcon
          name="i-lucide-search-x"
          class="size-6"
        />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-900">
        Keine Decks gefunden
      </h2>
      <p class="mt-1 max-w-sm text-sm text-gray-500">
        Kein Deckname und keine enthaltene Karte passt zu "{{ debouncedSearch }}".
      </p>
    </div>

    <ul
      v-else
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <li
        v-for="deck in decks"
        :key="deck.id"
        class="flex flex-col rounded-md border border-gray-200 bg-white p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <NuxtLink
            :to="`/decks/${deck.id}`"
            class="min-w-0 flex-1"
          >
            <h2 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
              {{ deck.name }}
            </h2>
            <p
              v-if="deck.description"
              class="mt-0.5 line-clamp-2 text-sm text-gray-500"
            >
              {{ deck.description }}
            </p>
          </NuxtLink>

          <UDropdownMenu :items="menuItemsFor(deck)">
            <UButton
              icon="i-lucide-more-horizontal"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Optionen für ${deck.name}`"
            />
          </UDropdownMenu>
        </div>

        <dl class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          <div class="flex gap-1">
            <dt>Main</dt>
            <dd class="font-semibold tabular-nums text-gray-900">
              {{ deck.mainCount }}
            </dd>
          </div>
          <div class="flex gap-1">
            <dt>Extra</dt>
            <dd class="font-semibold tabular-nums text-gray-900">
              {{ deck.extraCount }}
            </dd>
          </div>
          <div class="flex gap-1">
            <dt>Side</dt>
            <dd class="font-semibold tabular-nums text-gray-900">
              {{ deck.sideCount }}
            </dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColor(deck)"
            variant="subtle"
            :label="statusLabel(deck)"
          />
          <SharingVisibilityBadge
            :visibility="deck.visibility"
            hide-private
          />
          <UBadge
            v-if="deck.formatName"
            color="neutral"
            variant="subtle"
            icon="i-lucide-scroll-text"
            :label="deck.formatName"
          />
          <UBadge
            v-if="deck.legal !== null"
            :color="deck.legal ? 'success' : 'error'"
            variant="subtle"
            :label="deck.legal ? 'Legal' : 'Nicht legal'"
          />
          <span class="ml-auto text-xs text-gray-400">{{ deck.cardCount }} Karten</span>
        </div>
      </li>
    </ul>

    <div
      v-if="total > PAGE_SIZE"
      class="flex justify-end"
    >
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="PAGE_SIZE"
      />
    </div>

    <DecksDeckFormModal
      v-model:open="isFormOpen"
      :initial-values="editingDeck"
      @saved="onSaved"
    />

    <SharingShareModal
      v-if="sharingDeck"
      v-model:open="isShareOpen"
      resource-type="deck"
      :resource-id="sharingDeck.id"
      :resource-name="sharingDeck.name"
      :share-path="sharePath"
      @updated="onShareUpdated"
    />
  </div>
</template>
