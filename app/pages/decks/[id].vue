<script setup lang="ts">
import {
  DECK_SECTIONS,
  defaultSectionForCard,
  isSectionAllowedForCard,
} from '~~/shared/deck-sections'
import type { DeckCover } from '~~/shared/deck-cover'
import type { DeckSection } from '~~/shared/deck-sections'
import type { DeckValidation, DeckWarning } from '~~/shared/rule-formats'
import type { Visibility } from '~~/shared/sharing'
import { cardFrame } from '~/utils/card-frame'
import { deckCountState, deckMeterFill } from '~/utils/deck-meter'

interface DeckCardRow {
  catalogCardId: number
  name: string
  nameDe: string | null
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  section: DeckSection
  quantity: number
  owned: number
  usedInDeck: number
  shortfall: number
}

interface DeckDetail {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  sections: Record<DeckSection, DeckCardRow[]>
  counts: { main: number, extra: number, side: number, total: number }
  limits: { mainMin: number, mainMax: number, extraMax: number, sideMax: number, maxCopies: number }
  warnings: DeckWarning[]
  format: { id: string, name: string, isBuiltin: boolean } | null
  validation: DeckValidation | null
  visibility: Visibility
  /** Effective cover (#49); read null-safely, older fixtures lack it. */
  cover: DeckCover | null
  coverIsChosen: boolean
  /** The chosen cover while it isn't in Main/Extra (#57); read null-safely, older fixtures lack it. */
  inactiveCoverChoice?: DeckCover | null
}

interface RuleFormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

interface SourceCard {
  catalogCardId: number
  name: string
  nameDe: string | null
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  imageSmall: string | null
  owned: number
}

interface InventorySearchItem {
  catalogCardId: number
  name: string
  nameDe: string | null
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  imageSmall: string | null
  totalQuantity: number
}

interface CatalogSearchItem {
  id: number
  name: string
  nameDe: string | null
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  imageSmall: string | null
}

interface SearchFacets {
  types: string[]
  attributes: string[]
}

const SOURCE_PAGE_SIZE = 12

const route = useRoute()
const deckId = computed(() => String(route.params.id ?? ''))

const { t, n } = useI18n()
const { cardName, cardMetaLine, cardValueOptions } = useCardText()
const count = useCount()
const apiError = useApiError()
const validationText = useValidationText()
const { formatName, ruleLabel, sortFormats } = useFormatLabel()
const { describeCapReason } = useRuleDescription()

const errorMessage = ref('')
const isFormOpen = ref(false)

const {
  data: deck,
  pending,
  error,
} = await useFetch<DeckDetail>(() => `/api/decks/${deckId.value}`, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

usePageTitle(() => deck.value?.name ?? t('decks.editor.fallbackTitle'))

// --- Card source panel (inventory, optionally the whole catalog) -----------

const sourceSearch = ref('')
const debouncedSourceSearch = ref('')
const sourceType = ref('')
const sourceAttribute = ref('')
const includeCatalog = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(sourceSearch, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSourceSearch.value = value.trim()
  }, 300)
})

// Always page 1: `useFetch` owns the first page (SSR), "Mehr laden" appends
// the following pages client-side (`loadMoreSourceCards`).
const sourceQuery = computed(() => ({
  q: debouncedSourceSearch.value || undefined,
  type: sourceType.value || undefined,
  attribute: sourceAttribute.value || undefined,
  sort: 'name',
  page: 1,
  pageSize: SOURCE_PAGE_SIZE,
}))

type SourceItem = InventorySearchItem | CatalogSearchItem

interface SourcePage {
  items: SourceItem[]
  total: number
}

function sourceEndpoint(catalog: boolean) {
  return catalog ? '/api/catalog/cards' : '/api/inventory/search'
}

function sourceItemId(item: SourceItem): number {
  return (item as Partial<InventorySearchItem>).catalogCardId ?? (item as Partial<CatalogSearchItem>).id ?? 0
}

// One endpoint at a time: the owned-cards search by default, the full catalog
// when the user wants to plan with cards they do not own yet (those come back
// with `owned: 0`, so the deck shows a shortfall).
const { data: sourceData, pending: sourcePending } = await useFetch<SourcePage>(() => sourceEndpoint(includeCatalog.value), {
  query: sourceQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0 }),
})

// In catalog mode the items carry no ownership data, so the owned totals for
// exactly the listed cards are fetched separately — otherwise every catalog
// row would claim "Besitz: 0" even for cards the user owns.
const catalogCardIds = computed(() => (includeCatalog.value
  ? (sourceData.value?.items ?? []).map(item => (item as CatalogSearchItem).id).filter(Boolean)
  : []))

const { data: ownedQuantities } = await useFetch<Record<string, number>>('/api/inventory/owned-quantities', {
  query: computed(() => ({ ids: catalogCardIds.value.join(',') })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({}),
})

// The facet lists come from the inventory (the default source); in catalog
// mode they stay a useful shortlist rather than the full catalog vocabulary.
const { data: facets } = await useFetch<SearchFacets>('/api/inventory/search/facets', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ types: [], attributes: [] }),
})

// --- Rule format + live validation ----------------------------------------

const { data: formatsData } = await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

// reka-ui reserves the empty string for "clear selection", so "no format" uses
// a sentinel that maps back to `null` on the wire.
const NO_FORMAT = '__no_format__'

const formatItems = computed(() => [
  { label: t('decks.editor.noFormat'), value: NO_FORMAT },
  ...sortFormats(formatsData.value?.items ?? []).map(format => ({
    label: format.isBuiltin ? formatName(format) : t('decks.editor.ownFormat', { name: format.name }),
    value: format.id,
  })),
])

// --- Chat assistant entry point ("Mit KI bearbeiten", ADR 0011) -------------

const { data: assistantStatus } = await useAssistantStatus()

// --- Sharing (Phase 6) -------------------------------------------------------

// Cheap, lazily creates the profile on first read — needed only to build the
// share link (`/players/:handle/decks/:id`).
const { data: ownProfile } = await useOwnProfile()

const isShareOpen = ref(false)
const sharePath = computed(() => `/players/${ownProfile.value?.handle ?? ''}/decks/${deckId.value}`)

function onShareUpdated(visibility: Visibility) {
  if (deck.value) {
    deck.value = { ...deck.value, visibility }
  }
}

const validation = computed(() => deck.value?.validation ?? null)

const issueCardIds = computed(() => new Set(
  (validation.value?.issues ?? []).flatMap(issue => (issue.cardId ? [issue.cardId] : [])),
))

function cardStatusFor(catalogCardId: number) {
  const entry = validation.value?.cards?.[catalogCardId]
  return entry && entry.status !== 'unrestricted' ? entry : null
}

function statusLabelFor(catalogCardId: number): string | null {
  const entry = cardStatusFor(catalogCardId)
  return entry ? t(`formats.cardStatus.${entry.status}`) : null
}

// The status badge's tooltip: why the card's copy limit is lowered.
function statusReasonsFor(catalogCardId: number): string | undefined {
  const entry = cardStatusFor(catalogCardId)
  if (!entry || !deck.value) {
    return undefined
  }
  const format = deck.value.format
  const cardNames = Object.fromEntries(DECK_SECTIONS.flatMap(section => sections.value[section].map(row => [row.catalogCardId, cardName(row)])))
  return entry.reasons
    .map(reason => describeCapReason(reason, { cardNames, filterLabel: label => (format ? ruleLabel(format, label) : label) }))
    .join(' · ')
}

function statusColorFor(catalogCardId: number) {
  const entry = cardStatusFor(catalogCardId)
  return entry?.status === 'forbidden' ? ('error' as const) : ('warning' as const)
}

const validationBadge = computed(() => {
  if (!deck.value?.format) {
    return { label: t('decks.editor.validation.noFormatSelected'), color: 'neutral' as const }
  }
  const current = validation.value
  if (!current) {
    return { label: t('decks.editor.validation.noFormatSelected'), color: 'neutral' as const }
  }
  if (current.legal) {
    return { label: t('validation.badge.legal'), color: 'success' as const }
  }
  return {
    label: count('validation.badge.notLegalCount', current.issues.length),
    color: 'error' as const,
  }
})

// reka-ui reserves the empty string for "clear selection", so the "no filter"
// options use sentinels that map back to '' (same convention as
// InventorySearchPanel).
const ALL_TYPES = '__all_types__'
const ALL_ATTRIBUTES = '__all_attributes__'

const typeItems = computed(() => [
  { label: t('decks.editor.addPanel.allTypes'), value: ALL_TYPES },
  ...cardValueOptions('type', facets.value?.types ?? []),
])
const attributeItems = computed(() => [
  { label: t('decks.editor.addPanel.allAttributes'), value: ALL_ATTRIBUTES },
  ...cardValueOptions('attribute', facets.value?.attributes ?? []),
])

const typeSelection = computed({
  get: () => sourceType.value || ALL_TYPES,
  set: (value: string) => {
    sourceType.value = value === ALL_TYPES ? '' : value
  },
})
const attributeSelection = computed({
  get: () => sourceAttribute.value || ALL_ATTRIBUTES,
  set: (value: string) => {
    sourceAttribute.value = value === ALL_ATTRIBUTES ? '' : value
  },
})

// --- "Mehr laden" (pages 2+ of the add panel) -------------------------------

// Further pages are appended one at a time via `$fetch`; in catalog mode each
// page also fetches its own owned totals (the endpoint caps ids at 100).
const extraSourceItems = ref<SourceItem[]>([])
const extraOwned = ref<Record<string, number>>({})
const loadedSourcePages = ref(1)
const isLoadingMore = ref(false)
const loadMoreError = ref('')
// A page that came back short or empty ends the list even if `total` (from
// page 1) promised more — the data changed underneath.
const sourceExhausted = ref(false)
// Bumped on every filter/source change, so a "Mehr laden" answer for the
// previous query is dropped instead of being appended to the new list.
let sourceGeneration = 0

function resetSourcePaging() {
  sourceGeneration += 1
  extraSourceItems.value = []
  extraOwned.value = {}
  loadedSourcePages.value = 1
  isLoadingMore.value = false
  loadMoreError.value = ''
  sourceExhausted.value = false
}

watch([includeCatalog, sourceQuery], resetSourcePaging)

const sourceItems = computed<SourceItem[]>(() => [
  ...(sourceData.value?.items ?? []),
  ...extraSourceItems.value,
])

const sourceCards = computed<SourceCard[]>(() => sourceItems.value.map((item) => {
  const inventoryItem = item as Partial<InventorySearchItem>
  const catalogItem = item as Partial<CatalogSearchItem>
  const catalogCardId = sourceItemId(item)
  return {
    catalogCardId,
    name: item.name,
    nameDe: item.nameDe ?? null,
    type: item.type,
    frameType: catalogItem.frameType ?? null,
    attribute: item.attribute ?? null,
    race: item.race ?? null,
    level: item.level ?? null,
    imageSmall: item.imageSmall ?? null,
    owned: inventoryItem.totalQuantity
      ?? ownedQuantities.value?.[String(catalogCardId)]
      ?? extraOwned.value[String(catalogCardId)]
      ?? 0,
  }
}))

const sourceTotal = computed(() => sourceData.value?.total ?? 0)
const hasMoreSource = computed(() => !sourceExhausted.value && sourceCards.value.length < sourceTotal.value)

async function loadMoreSourceCards() {
  if (isLoadingMore.value || !hasMoreSource.value) {
    return
  }

  const generation = sourceGeneration
  const catalog = includeCatalog.value
  isLoadingMore.value = true
  loadMoreError.value = ''

  try {
    const page = await $fetch<SourcePage>(sourceEndpoint(catalog), {
      query: { ...sourceQuery.value, page: loadedSourcePages.value + 1 },
    })

    let owned: Record<string, number> = {}
    const ids = catalog ? page.items.map(sourceItemId).filter(Boolean) : []
    if (ids.length > 0) {
      owned = await $fetch<Record<string, number>>('/api/inventory/owned-quantities', {
        query: { ids: ids.join(',') },
      })
    }

    if (generation !== sourceGeneration) {
      return
    }

    const known = new Set(sourceItems.value.map(sourceItemId))
    extraSourceItems.value = [...extraSourceItems.value, ...page.items.filter(item => !known.has(sourceItemId(item)))]
    extraOwned.value = { ...extraOwned.value, ...owned }
    loadedSourcePages.value += 1
    if (page.items.length < SOURCE_PAGE_SIZE) {
      sourceExhausted.value = true
    }
  }
  catch {
    if (generation === sourceGeneration) {
      loadMoreError.value = t('decks.editor.addPanel.loadMoreFailed')
    }
  }
  finally {
    if (generation === sourceGeneration) {
      isLoadingMore.value = false
    }
  }
}

// The add panel sits below the deck on small screens and can be collapsed
// there (CSS keeps it open from `lg` up). Seeded from the SSR payload, so
// server and client agree — no viewport check, no hydration mismatch. An
// empty deck starts expanded: adding cards is the only thing to do there.
// A plain ref on purpose, so the panel does not snap shut after the first add.
const isAddPanelOpen = ref((deck.value?.counts.total ?? 0) === 0)
const addPanel = useTemplateRef<HTMLElement>('addPanel')

async function openAddPanel() {
  isAddPanelOpen.value = true
  await nextTick()
  addPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// --- Deck helpers ----------------------------------------------------------

function sectionName(section: DeckSection): string {
  return t(`decks.section.${section}`)
}

const sections = computed(() => deck.value?.sections ?? { main: [], extra: [], side: [] })
const counts = computed(() => deck.value?.counts ?? { main: 0, extra: 0, side: 0, total: 0 })
const limits = computed(() => deck.value?.limits ?? { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 })
const warnings = computed(() => deck.value?.warnings ?? [])

const usedByCard = computed(() => {
  const used = new Map<number, number>()
  for (const section of DECK_SECTIONS) {
    for (const row of sections.value[section]) {
      used.set(row.catalogCardId, (used.get(row.catalogCardId) ?? 0) + row.quantity)
    }
  }
  return used
})

function quantityInSection(catalogCardId: number, section: DeckSection): number {
  return sections.value[section].find(row => row.catalogCardId === catalogCardId)?.quantity ?? 0
}

function sectionLimitLabel(section: DeckSection): string {
  if (section === 'main') {
    return `${counts.value.main}/${limits.value.mainMin}–${limits.value.mainMax}`
  }
  const max = section === 'extra' ? limits.value.extraMax : limits.value.sideMax
  return `${counts.value[section]}/${max}`
}

function sectionCountState(section: DeckSection) {
  return deckCountState(section, counts.value[section], limits.value)
}

function sectionMeterFill(section: DeckSection): string {
  return `${deckMeterFill(section, counts.value[section], limits.value)}%`
}

const SECTION_COUNT_CLASS = {
  under: 'text-warning',
  over: 'text-error',
  ok: 'text-success',
  none: 'text-muted',
} as const

function sectionCountClass(section: DeckSection): string {
  return SECTION_COUNT_CLASS[sectionCountState(section)]
}

// --- Mutations -------------------------------------------------------------

// Deck writes send an *absolute* quantity derived from the rendered deck, so
// two overlapping writes would compute from the same stale state. Controls are
// disabled while a write is in flight, and a sequence token drops the answer of
// any request that was superseded before it came back.
const inFlightMutations = ref(0)
const isMutating = computed(() => inFlightMutations.value > 0)
let mutationSequence = 0

// Bumped after every write so uncontrolled quantity inputs re-render from the
// server state (a rejected write must not leave a typed value behind).
const inputEpoch = ref(0)

async function applyDeck(request: Promise<DeckDetail>) {
  const token = ++mutationSequence
  inFlightMutations.value += 1
  errorMessage.value = ''

  try {
    const detail = await request
    if (token === mutationSequence) {
      deck.value = detail
    }
  }
  catch (requestError) {
    if (token === mutationSequence) {
      errorMessage.value = apiError(requestError, 'decks.editor.errors.saveFailed')
    }
  }
  finally {
    inFlightMutations.value -= 1
    inputEpoch.value += 1
  }
}

async function setQuantity(catalogCardId: number, section: DeckSection, quantity: number) {
  if (quantity < 0 || isMutating.value) {
    return
  }

  await applyDeck($fetch<DeckDetail>(`/api/decks/${deckId.value}/cards`, {
    method: 'PUT',
    body: { catalogCardId, section, quantity },
  }))
}

const formatSelection = computed({
  get: () => deck.value?.format?.id ?? NO_FORMAT,
  set: (value: string) => {
    changeFormat(value === NO_FORMAT ? null : value)
  },
})

// The PATCH answers with the recomputed deck detail, so assigning a format
// renders its validation without a reload.
async function changeFormat(formatId: string | null) {
  if (isMutating.value || (deck.value?.format?.id ?? null) === formatId) {
    return
  }

  await applyDeck($fetch<DeckDetail>(`/api/decks/${deckId.value}`, {
    method: 'PATCH',
    body: { formatId },
  }))
}

async function addCard(card: SourceCard, section: DeckSection) {
  await setQuantity(card.catalogCardId, section, quantityInSection(card.catalogCardId, section) + 1)
}

/**
 * Set only when *every* section button for this card is disallowed by its
 * card type (never just because a mutation is in flight) — the per-button
 * `title` tooltip alone left mouse-only users with three identically grey
 * buttons and no visible explanation (UX review #13).
 */
function allSectionsDisallowedReason(card: SourceCard): string | null {
  const disallowed = DECK_SECTIONS.every(section => !isSectionAllowedForCard(card, section))
  return disallowed ? t('decks.editor.addPanel.noSection', { name: cardName(card) }) : null
}

async function removeCard(row: DeckCardRow) {
  if (isMutating.value) {
    return
  }

  await applyDeck($fetch<DeckDetail>(`/api/decks/${deckId.value}/cards`, {
    method: 'DELETE',
    query: { catalogCardId: row.catalogCardId, section: row.section },
  }))
}

async function moveCard(row: DeckCardRow, to: DeckSection) {
  if (isMutating.value) {
    return
  }

  await applyDeck($fetch<DeckDetail>(`/api/decks/${deckId.value}/cards/move`, {
    method: 'POST',
    body: { catalogCardId: row.catalogCardId, from: row.section, to },
  }))
}

function onQuantityInput(row: DeckCardRow, value: string | number) {
  const raw = String(value).trim()
  const quantity = Number(raw)

  // An emptied or malformed field is not "remove this card" — snap the input
  // back to the stored quantity instead.
  if (raw === '' || !Number.isInteger(quantity) || quantity < 0) {
    inputEpoch.value += 1
    return
  }

  setQuantity(row.catalogCardId, row.section, quantity)
}

/** The row showing the deck's effective cover card (#49) — never a Side Deck row. */
function isCoverRow(row: DeckCardRow): boolean {
  return row.section !== 'side' && deck.value?.cover?.catalogCardId === row.catalogCardId
}

// `null` goes back to the automatic (rule) pick.
async function setCover(coverCardId: number | null) {
  if (isMutating.value) {
    return
  }

  await applyDeck($fetch<DeckDetail>(`/api/decks/${deckId.value}`, {
    method: 'PATCH',
    body: { coverCardId },
  }))
}

// The hint for a chosen cover that is no longer in Main/Extra (#57) offers
// to clear the stored choice; ADR 0012 keeps it until the user does.
const inactiveCoverActions = computed(() => [{
  label: t('decks.editor.cover.clearChoice'),
  color: 'neutral' as const,
  variant: 'outline' as const,
  size: 'xs' as const,
  disabled: isMutating.value,
  onClick: () => setCover(null),
}])

function rowMenuItems(row: DeckCardRow) {
  const moveItems = DECK_SECTIONS
    .filter(section => section !== row.section)
    .map(section => ({
      label: t('decks.editor.row.moveTo', { section: sectionName(section) }),
      icon: 'i-lucide-arrow-right-left',
      disabled: !isSectionAllowedForCard(row, section),
      onSelect: () => moveCard(row, section),
    }))

  // Side Deck cards are never a cover.
  if (row.section === 'side') {
    return [moveItems]
  }

  // A rule-picked cover row still offers "festlegen", to pin it.
  const coverItem = isCoverRow(row) && deck.value?.coverIsChosen
    ? { label: t('decks.editor.row.coverAuto'), icon: 'i-lucide-image-off', onSelect: () => setCover(null) }
    : { label: t('decks.editor.row.coverSet'), icon: 'i-lucide-image', onSelect: () => setCover(row.catalogCardId) }

  return [moveItems, [coverItem]]
}

async function onDeckSaved(saved: { id: string }) {
  deck.value = await $fetch<DeckDetail>(`/api/decks/${saved.id}`)
}

const { confirm } = useConfirm()

async function deleteDeck() {
  if (!deck.value) {
    return
  }

  const confirmed = await confirm({
    title: t('decks.confirm.delete.title'),
    description: t('decks.confirm.delete.description', { name: deck.value.name }),
  })
  if (!confirmed) {
    return
  }

  errorMessage.value = ''
  try {
    await $fetch(`/api/decks/${deckId.value}`, { method: 'DELETE' })
  }
  catch (requestError) {
    errorMessage.value = apiError(requestError, 'decks.errors.deleteFailed')
    return
  }

  await navigateTo('/decks')
}

// Secondary actions live in the "…" menu at every width (#25), so the header
// toolbar stays one short row and the title keeps its full width (#40).
const deckMenuItems = computed(() => [
  [{ label: t('decks.menu.rename'), icon: 'i-lucide-pencil', onSelect: () => { isFormOpen.value = true } }],
  [{ label: t('common.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: deleteDeck }],
])

const loadErrorDescription = computed(() => (error.value ? apiError(error.value, 'decks.editor.loadFailedDescription') : undefined))
</script>

<template>
  <div class="space-y-6">
    <div>
      <LayoutBackLink
        to="/decks"
        :label="t('decks.editor.back')"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="t('decks.editor.loadFailed')"
      :description="loadErrorDescription"
    />

    <div
      v-else-if="pending && !deck"
      class="space-y-4"
    >
      <USkeleton class="h-10 w-64" />
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="deck">
      <!-- The toolbar sits in the default slot, i.e. always *below* the title:
           the `#actions` slot would put it beside the title from `sm` up and
           squeeze a long deck name down to "Cyb…" at 1024px (#40). -->
      <LayoutPageHeader
        :title="deck.name"
        :description="deck.description ?? undefined"
      >
        <p class="mt-1 text-sm text-muted">
          {{ count('decks.editor.totalCards', counts.total) }}
        </p>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div class="flex flex-wrap items-center gap-2">
            <!-- Mobile shortcut: the add panel lives below the deck sections. -->
            <UButton
              icon="i-lucide-plus"
              :label="t('decks.editor.addCards')"
              class="lg:hidden"
              @click="openAddPanel"
            />
            <UButton
              v-if="assistantStatus?.chat"
              icon="i-lucide-sparkles"
              color="neutral"
              variant="outline"
              :label="t('decks.editor.editWithAi')"
              :to="{ path: '/assistant', query: { deckId } }"
            />
            <UButton
              icon="i-lucide-share-2"
              color="neutral"
              variant="outline"
              :label="t('decks.editor.share')"
              :disabled="!ownProfile?.handle"
              @click="() => { isShareOpen = true }"
            />
            <UDropdownMenu :items="deckMenuItems">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                :aria-label="t('decks.editor.moreActions')"
                class="tap-target"
              />
            </UDropdownMenu>
          </div>

          <div class="flex items-center gap-2 sm:ml-auto">
            <SharingVisibilityBadge :visibility="deck.visibility" />
            <USelect
              v-model="formatSelection"
              :items="formatItems"
              :disabled="isMutating"
              class="min-w-0 flex-1 sm:w-56 sm:flex-none"
              :aria-label="t('decks.editor.formatLabel')"
            />
          </div>
        </div>
      </LayoutPageHeader>

      <section
        class="panel p-4"
        :class="deck.format && validation?.legal ? 'ring-1 ring-success/40' : undefined"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('decks.editor.validation.title') }}
          </h2>
          <UBadge
            :color="validationBadge.color"
            variant="subtle"
            :label="validationBadge.label"
            :aria-label="t('decks.editor.validation.statusLabel')"
          />
        </div>

        <p
          v-if="!deck.format"
          class="mt-2 text-sm text-muted"
        >
          {{ t('decks.editor.validation.chooseFormat') }}
        </p>
        <p
          v-else-if="validation?.legal"
          class="mt-2 text-sm text-muted"
        >
          {{ t('decks.editor.validation.legal', { format: formatName(deck.format) }) }}
        </p>
        <ul
          v-else
          class="mt-2 list-inside list-disc space-y-0.5 text-sm text-error"
        >
          <li
            v-for="(issue, index) in validation?.issues ?? []"
            :key="`${issue.code}-${issue.cardId ?? issue.section ?? index}`"
          >
            {{ validationText(issue) }}
          </li>
        </ul>
      </section>

      <UAlert
        v-if="warnings.length > 0 && !deck.format && counts.total > 0"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('decks.warningsTitle')"
      >
        <template #description>
          <ul class="list-inside list-disc space-y-0.5">
            <li
              v-for="warning in warnings"
              :key="`${warning.code}-${warning.cardId ?? ''}`"
            >
              {{ validationText(warning) }}
            </li>
          </ul>
        </template>
      </UAlert>

      <UAlert
        v-if="deck.inactiveCoverChoice"
        color="neutral"
        variant="subtle"
        icon="i-lucide-image-off"
        :title="t('decks.editor.cover.inactiveTitle')"
        :description="t('decks.editor.cover.inactiveDescription', { name: cardName(deck.inactiveCoverChoice) })"
        :actions="inactiveCoverActions"
      />

      <p
        v-if="errorMessage"
        class="text-sm text-error"
      >
        {{ errorMessage }}
      </p>

      <div class="flex flex-col gap-6 lg:flex-row">

        <!-- A container, so the rows switch layout by the column's own width:
             beside the add panel at 1024px it is only ~360px wide. -->
        <div class="@container min-w-0 flex-1 space-y-6">
          <section
            v-for="section in DECK_SECTIONS"
            :key="section"
            class="panel overflow-hidden"
          >
            <header
              class="flex items-center justify-between gap-3 border-b border-default bg-linear-to-r to-transparent px-4 py-3"
              :class="section === 'main' ? 'from-primary/8' : section === 'extra' ? 'from-attr-dark/12' : 'from-elevated/70'"
            >
              <h2 class="text-base font-semibold text-highlighted">
                {{ sectionName(section) }}
              </h2>
              <!-- The meter is decorative; the count is the information. -->
              <div
                class="deck-meter w-24 text-right sm:w-28"
                :data-state="sectionCountState(section)"
                :style="{ '--fill': sectionMeterFill(section) }"
              >
                <span
                  class="font-numeric text-sm font-bold tracking-[0.04em] tabular-nums"
                  :class="sectionCountClass(section)"
                  :data-state="sectionCountState(section)"
                  :aria-label="t('decks.editor.countIn', { section: sectionName(section) })"
                >
                  {{ sectionLimitLabel(section) }}
                </span>
              </div>
            </header>

            <p
              v-if="sections[section].length === 0"
              class="px-4 py-6 text-sm text-muted"
            >
              {{ t('decks.editor.emptySection', { section: sectionName(section) }) }}
            </p>

            <ul
              v-else
              class="divide-y divide-default"
            >
              <!-- One line from a 32rem-wide column (`@lg`); narrower, the
                   controls drop to a second line under the name (#40). -->
              <li
                v-for="row in sections[section]"
                :key="`${section}-${row.catalogCardId}`"
                class="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 @lg:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]"
                :class="issueCardIds.has(row.catalogCardId) ? 'bg-error/10' : undefined"
                :data-issue="issueCardIds.has(row.catalogCardId) ? '' : undefined"
                :data-frame="cardFrame(row)?.frame"
                :data-pendulum="cardFrame(row)?.pendulum ? '' : undefined"
              >
                <!-- The card's frame color as a stripe on the row's edge (decorative). -->
                <span
                  class="frame-stripe-y absolute inset-y-2 left-0 w-[3px] rounded-e-full"
                  aria-hidden="true"
                />
                <CardThumb
                  :src="row.imageSmall"
                  :alt="cardName(row)"
                  size="sm"
                  class="row-span-2 self-start @lg:row-span-1 @lg:self-center"
                />

                <div class="min-w-0">
                  <p
                    class="line-clamp-2 text-sm font-medium break-words text-highlighted"
                    :title="cardName(row)"
                  >
                    {{ cardName(row) }}
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ cardMetaLine(row) }}
                  </p>
                  <div
                    v-if="statusLabelFor(row.catalogCardId) || isCoverRow(row)"
                    class="mt-0.5 flex flex-wrap gap-1"
                  >
                    <UBadge
                      v-if="statusLabelFor(row.catalogCardId)"
                      size="sm"
                      variant="subtle"
                      :color="statusColorFor(row.catalogCardId)"
                      :label="statusLabelFor(row.catalogCardId) ?? ''"
                      :title="statusReasonsFor(row.catalogCardId)"
                    />
                    <UBadge
                      v-if="isCoverRow(row)"
                      size="sm"
                      variant="subtle"
                      color="primary"
                      icon="i-lucide-image"
                      :label="deck.coverIsChosen ? t('decks.editor.cover.chosen') : t('decks.editor.cover.auto')"
                    />
                  </div>
                </div>

                <span
                  class="self-start text-xs tabular-nums @lg:self-center"
                  :class="row.shortfall > 0 ? 'font-semibold text-error' : 'text-muted'"
                  :data-shortfall="row.shortfall > 0 ? '' : undefined"
                  :title="row.shortfall > 0 ? t('decks.editor.row.ownedOnly', { owned: row.owned }) : undefined"
                >
                  {{ row.usedInDeck }}/{{ row.owned }}
                </span>

                <div class="col-span-2 flex items-center justify-end gap-1 @lg:col-span-1">
                  <UButton
                    icon="i-lucide-minus"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    class="tap-target"
                    :disabled="isMutating"
                    :aria-label="t('decks.editor.row.removeOne', { name: cardName(row), section: sectionName(section) })"
                    @click="setQuantity(row.catalogCardId, section, row.quantity - 1)"
                  />
                  <!-- Spin buttons hidden: − and + already step, and the
                       arrows ate the narrow field's digits. -->
                  <UInput
                    :key="`${section}-${row.catalogCardId}-${inputEpoch}`"
                    :model-value="row.quantity"
                    type="number"
                    min="0"
                    size="xs"
                    class="w-12"
                    :ui="{ base: 'text-center tabular-nums max-lg:min-h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' }"
                    :disabled="isMutating"
                    :aria-label="t('decks.editor.row.quantity', { name: cardName(row), section: sectionName(section) })"
                    @change="(event: Event) => onQuantityInput(row, (event.target as HTMLInputElement).value)"
                  />
                  <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    class="tap-target"
                    :disabled="isMutating"
                    :aria-label="t('decks.editor.row.addOne', { name: cardName(row), section: sectionName(section) })"
                    @click="setQuantity(row.catalogCardId, section, row.quantity + 1)"
                  />
                  <UDropdownMenu :items="rowMenuItems(row)">
                    <UButton
                      icon="i-lucide-ellipsis-vertical"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      class="tap-target"
                      :disabled="isMutating"
                      :aria-label="t('decks.editor.row.options', { name: cardName(row) })"
                    />
                  </UDropdownMenu>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    class="tap-target"
                    :disabled="isMutating"
                    :aria-label="t('decks.editor.row.remove', { name: cardName(row), section: sectionName(section) })"
                    @click="removeCard(row)"
                  />
                </div>
              </li>
            </ul>
          </section>
        </div>

        <aside
          id="deck-add-panel"
          ref="addPanel"
          aria-labelledby="deck-add-panel-title"
          class="w-full shrink-0 scroll-mt-4 lg:sticky lg:top-8 lg:w-80 lg:self-start xl:w-96"
        >
          <!-- On lg the panel sticks beside the deck and only the result list
               scrolls; below lg it sits under the deck and can be collapsed. -->
          <div class="panel flex flex-col p-4 lg:max-h-[calc(100dvh-4rem)]">
            <div class="flex items-center justify-between gap-2">
              <h2
                id="deck-add-panel-title"
                class="text-base font-semibold text-highlighted"
              >
                {{ t('decks.editor.addPanel.title') }}
              </h2>
              <UButton
                class="tap-target lg:hidden"
                color="neutral"
                variant="ghost"
                size="sm"
                :label="isAddPanelOpen ? t('decks.editor.addPanel.hide') : t('decks.editor.addPanel.show')"
                :trailing-icon="isAddPanelOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                :aria-expanded="isAddPanelOpen"
                aria-controls="deck-add-panel-body"
                @click="() => { isAddPanelOpen = !isAddPanelOpen }"
              />
            </div>

            <div
              id="deck-add-panel-body"
              class="min-h-0 flex-1 flex-col"
              :class="isAddPanelOpen ? 'flex' : 'hidden lg:flex'"
            >
              <div class="mt-3 shrink-0 space-y-2">
                <UInput
                  v-model="sourceSearch"
                  icon="i-lucide-search"
                  :placeholder="t('decks.editor.addPanel.searchPlaceholder')"
                  :aria-label="t('decks.editor.addPanel.searchLabel')"
                  class="w-full"
                />
                <div class="flex gap-2">
                  <USelect
                    v-model="typeSelection"
                    :items="typeItems"
                    :aria-label="t('decks.editor.addPanel.type')"
                    class="flex-1"
                  />
                  <USelect
                    v-model="attributeSelection"
                    :items="attributeItems"
                    :aria-label="t('decks.editor.addPanel.attribute')"
                    class="flex-1"
                  />
                </div>
                <UCheckbox
                  v-model="includeCatalog"
                  :label="t('decks.editor.addPanel.includeCatalog')"
                />
              </div>

              <p class="mt-3 shrink-0 text-xs text-muted">
                <template v-if="hasMoreSource">
                  {{ t('decks.editor.addPanel.shownOf', { shown: n(sourceCards.length, 'integer'), total: n(sourceTotal, 'integer') }) }}
                </template>
                <template v-else>
                  {{ count('decks.editor.addPanel.total', sourceTotal) }}
                </template>
              </p>

              <div class="-mx-4 mt-3 min-h-0 flex-1 px-4 lg:overflow-y-auto">
                <div
                  v-if="sourcePending"
                  class="space-y-2"
                >
                  <USkeleton
                    v-for="placeholder in 3"
                    :key="placeholder"
                    class="h-16 w-full"
                  />
                </div>

                <p
                  v-else-if="sourceCards.length === 0"
                  class="text-sm text-muted"
                >
                  <i18n-t
                    keypath="decks.editor.addPanel.empty"
                    scope="global"
                  >
                    <template #link>
                      <NuxtLink
                        to="/inventory"
                        class="font-medium text-primary"
                      >
                        {{ t('decks.editor.addPanel.emptyLink') }}
                      </NuxtLink>
                    </template>
                  </i18n-t>
                </p>

                <ul
                  v-else
                  class="divide-y divide-default"
                >
                  <li
                    v-for="card in sourceCards"
                    :key="card.catalogCardId"
                    class="flex gap-3 py-3"
                  >
                    <CardThumb
                      :src="card.imageSmall"
                      :alt="cardName(card)"
                      size="md"
                    />

                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-highlighted">
                        {{ cardName(card) }}
                      </p>
                      <p class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                        <CardFrameDot
                          :type="card.type"
                          :frame-type="card.frameType"
                        />
                        <span class="truncate">{{ cardMetaLine(card) }}</span>
                      </p>
                      <!-- Only cards already in the deck have a known status: the
                           whole inventory is never validated. -->
                      <UBadge
                        v-if="statusLabelFor(card.catalogCardId)"
                        class="mt-0.5"
                        size="sm"
                        variant="subtle"
                        :color="statusColorFor(card.catalogCardId)"
                        :label="statusLabelFor(card.catalogCardId) ?? ''"
                      />
                      <p class="mt-0.5 text-xs text-muted">
                        <i18n-t
                          keypath="decks.editor.addPanel.ownedInDeck"
                          scope="global"
                        >
                          <template #owned>
                            <span class="font-semibold tabular-nums">{{ card.owned }}</span>
                          </template>
                          <template #inDeck>
                            <span class="font-semibold tabular-nums">{{ usedByCard.get(card.catalogCardId) ?? 0 }}</span>
                          </template>
                        </i18n-t>
                      </p>

                      <div class="mt-1.5 flex flex-wrap gap-1">
                        <UButton
                          v-for="section in DECK_SECTIONS"
                          :key="section"
                          size="xs"
                          class="tap-target"
                          :color="section === defaultSectionForCard(card) ? 'primary' : 'neutral'"
                          :variant="section === defaultSectionForCard(card) ? 'solid' : 'outline'"
                          :disabled="!isSectionAllowedForCard(card, section) || isMutating"
                          :title="isSectionAllowedForCard(card, section)
                            ? undefined
                            : t('decks.editor.addPanel.cannotAdd', { name: cardName(card), section: sectionName(section) })"
                          :label="t('decks.editor.addPanel.addButton', { section: t(`decks.sectionShort.${section}`) })"
                          :aria-label="t('decks.editor.addPanel.addTo', { name: cardName(card), section: sectionName(section) })"
                          @click="addCard(card, section)"
                        />
                      </div>
                      <!-- Disabled buttons alone only explain themselves through
                           a native `title` tooltip, which mouse-only users never
                           see (UX review #13) — spell the reason out. -->
                      <p
                        v-if="allSectionsDisallowedReason(card)"
                        class="mt-1 text-xs text-error"
                      >
                        {{ allSectionsDisallowedReason(card) }}
                      </p>
                    </div>
                  </li>
                </ul>

                <UButton
                  v-if="hasMoreSource && !sourcePending"
                  block
                  color="neutral"
                  variant="outline"
                  :label="t('decks.editor.addPanel.loadMore')"
                  :loading="isLoadingMore"
                  class="mt-3 tap-target"
                  @click="loadMoreSourceCards"
                />
                <p
                  v-if="loadMoreError && !sourcePending"
                  class="mt-2 text-xs text-error"
                >
                  {{ loadMoreError }}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <DecksDeckFormModal
        v-model:open="isFormOpen"
        :initial-values="{ id: deck.id, name: deck.name, description: deck.description }"
        @saved="onDeckSaved"
      />

      <SharingShareModal
        v-model:open="isShareOpen"
        resource-type="deck"
        :resource-id="deckId"
        :resource-name="deck.name"
        :share-path="sharePath"
        @updated="onShareUpdated"
      />
    </template>
  </div>
</template>
