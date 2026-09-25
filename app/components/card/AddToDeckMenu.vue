<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { allowedSectionsForCard } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import type { DeckValidation, DeckWarning } from '~~/shared/rule-formats'
import type { CardDetailSummary } from '~/utils/card-detail'

// "Zum Deck" in the catalog's card detail (#148): the user's decks (recently
// changed first), each with a submenu of the sections the card may go in.
// Picking one adds a copy in one step (`PUT /api/decks/:id/cards` with
// `increment`), and a toast confirms it with the card's copy-limit and
// format warnings and a link to the deck.

const props = defineProps<{
  card: CardDetailSummary | null
}>()

interface DeckOption {
  id: string
  name: string
}

interface DeckDetailLite {
  sections: Record<DeckSection, Array<{ catalogCardId: number, quantity: number }>>
  warnings: DeckWarning[]
  validation: DeckValidation | null
}

// The API's largest page; the search reaches every other deck.
const DECK_PAGE_SIZE = 60
// From this many decks on, the menu gets a search field.
const FILTER_FROM_DECKS = 10

const { t } = useI18n()
const { cardName } = useCardText()
const validationText = useValidationText()
const apiError = useApiError()
const toast = useToast()

const decks = ref<DeckOption[]>([])
const loadState = ref<'idle' | 'loading' | 'error' | 'ready'>('idle')
// Decks the user has without a search; decides whether the search shows.
const deckTotal = ref(0)
const search = ref('')
const adding = ref(false)

let loadId = 0
async function load() {
  const id = ++loadId
  const q = search.value.trim()
  loadState.value = 'loading'
  try {
    const response = await $fetch<{ items: DeckOption[], total: number }>('/api/decks', {
      query: { pageSize: DECK_PAGE_SIZE, q: q || undefined },
    })
    if (id !== loadId) {
      return
    }
    decks.value = response.items.map(deck => ({ id: deck.id, name: deck.name }))
    if (!q) {
      deckTotal.value = response.total
    }
    loadState.value = 'ready'
  }
  catch {
    if (id === loadId) {
      loadState.value = 'error'
    }
  }
}

// Reloaded on every open: cheap, and always current.
function onOpen(open: boolean) {
  if (open) {
    clearTimeout(searchTimer)
    search.value = ''
    load()
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 250)
}
onBeforeUnmount(() => clearTimeout(searchTimer))

const showFilter = computed(() => deckTotal.value >= FILTER_FROM_DECKS || search.value !== '')

const items = computed<DropdownMenuItem[]>(() => {
  if (loadState.value === 'idle' || loadState.value === 'loading') {
    return [{ label: t('catalog.addToDeck.loading'), icon: 'i-lucide-loader-circle', disabled: true }]
  }
  if (loadState.value === 'error') {
    return [
      { label: t('catalog.addToDeck.loadFailed'), disabled: true },
      {
        label: t('common.retry'),
        icon: 'i-lucide-refresh-cw',
        onSelect: (event: Event) => {
          event.preventDefault()
          load()
        },
      },
    ]
  }
  if (decks.value.length === 0) {
    return search.value.trim()
      ? [{ label: t('catalog.addToDeck.noMatches'), disabled: true }]
      : [
          { label: t('catalog.addToDeck.noDecks'), disabled: true },
          { label: t('catalog.addToDeck.createDeck'), icon: 'i-lucide-plus', to: '/decks' },
        ]
  }
  const card = props.card
  const sections = card ? allowedSectionsForCard(card) : []
  return decks.value.map(deck => ({
    label: deck.name,
    icon: 'i-lucide-layers',
    children: sections.map(section => ({
      label: t(`decks.section.${section}`),
      onSelect: () => addTo(deck, section),
    })),
  }))
})

async function addTo(deck: DeckOption, section: DeckSection) {
  const card = props.card
  if (!card || adding.value) {
    return
  }
  adding.value = true
  try {
    const updated = await $fetch<DeckDetailLite>(`/api/decks/${deck.id}/cards`, {
      method: 'PUT',
      body: { catalogCardId: card.id, section, increment: 1 },
    })
    const quantity = updated.sections[section]?.find(row => row.catalogCardId === card.id)?.quantity ?? 1
    // Copy limits stay warnings, as in the deck editor: only this card's.
    const issues = [...updated.warnings, ...(updated.validation?.issues ?? [])]
      .filter(issue => issue.cardId === card.id)
    toast.add({
      title: t('catalog.addToDeck.added', { deck: deck.name }),
      description: [
        t('catalog.addToDeck.addedDescription', {
          card: cardName(card),
          count: quantity,
          section: t(`decks.section.${section}`),
        }),
        ...issues.map(issue => validationText(issue)),
      ].join(' '),
      color: issues.length ? 'warning' : 'success',
      icon: issues.length ? 'i-lucide-triangle-alert' : 'i-lucide-check',
      actions: [{
        label: t('catalog.addToDeck.openDeck'),
        to: `/decks/${deck.id}`,
        color: 'neutral',
        variant: 'outline',
      }],
    })
  }
  catch (error) {
    toast.add({
      title: apiError(error, 'catalog.addToDeck.failed'),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    adding.value = false
  }
}
</script>

<template>
  <UDropdownMenu
    :items="items"
    :filter="showFilter ? { placeholder: t('catalog.addToDeck.search'), icon: 'i-lucide-search' } : false"
    ignore-filter
    :search-term="search"
    :content="{ align: 'end', collisionPadding: 8 }"
    :ui="{ content: 'max-h-80 w-64 max-w-[calc(100vw-1rem)]' }"
    @update:open="onOpen"
    @update:search-term="onSearch"
  >
    <UButton
      icon="i-lucide-layers"
      trailing-icon="i-lucide-chevron-down"
      color="neutral"
      variant="outline"
      class="tap-target"
      :label="t('catalog.addToDeck.button')"
      :loading="adding"
      :disabled="!card || adding"
    />
  </UDropdownMenu>
</template>
