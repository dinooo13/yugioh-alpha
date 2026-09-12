<script setup lang="ts">
import {
  DECK_SECTION_LABELS,
  DECK_SECTIONS,
  defaultSectionForCard,
  isSectionAllowedForCard,
} from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import { CARD_STATUS_LABELS } from '~~/shared/rule-formats'
import type { DeckValidation } from '~~/shared/rule-formats'
import type { AssistantChange, AssistantMissingCard, DeckAssistantResult, DeckAssistantStatus } from '~~/shared/deck-assistant'
import type { OwnProfile, Visibility } from '~~/shared/sharing'
import { apiErrorMessage } from '~/utils/card-entry'
import type { AssistantRequestPayload } from '~/components/decks/AssistantRequestForm.vue'

interface DeckCardRow {
  catalogCardId: number
  name: string
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
  warnings: Array<{ code: string, message: string, cardId?: number }>
  format: { id: string, name: string, isBuiltin: boolean } | null
  validation: DeckValidation | null
  visibility: Visibility
}

interface RuleFormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

interface SourceCard {
  catalogCardId: number
  name: string
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

const errorMessage = ref('')
const isFormOpen = ref(false)

const {
  data: deck,
  pending,
  error,
} = await useFetch<DeckDetail>(() => `/api/decks/${deckId.value}`, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

useHead({ title: computed(() => `${deck.value?.name ?? 'Deck'} – yugioh alpha`) })

// --- Card source panel (inventory, optionally the whole catalog) -----------

const sourceSearch = ref('')
const debouncedSourceSearch = ref('')
const sourceType = ref('')
const sourceAttribute = ref('')
const sourcePage = ref(1)
const includeCatalog = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(sourceSearch, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSourceSearch.value = value.trim()
    sourcePage.value = 1
  }, 300)
})

watch([sourceType, sourceAttribute, includeCatalog], () => {
  sourcePage.value = 1
})

const sourceQuery = computed(() => ({
  q: debouncedSourceSearch.value || undefined,
  type: sourceType.value || undefined,
  attribute: sourceAttribute.value || undefined,
  sort: 'name',
  page: sourcePage.value,
  pageSize: SOURCE_PAGE_SIZE,
}))

// One endpoint at a time: the owned-cards search by default, the full catalog
// when the user wants to plan with cards they do not own yet (those come back
// with `owned: 0`, so the deck shows a shortfall).
const { data: sourceData, pending: sourcePending } = await useFetch<{
  items: Array<InventorySearchItem | CatalogSearchItem>
  total: number
}>(() => (includeCatalog.value ? '/api/catalog/cards' : '/api/inventory/search'), {
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
  { label: 'Kein Format', value: NO_FORMAT },
  ...(formatsData.value?.items ?? []).map(format => ({
    label: format.isBuiltin ? format.name : `${format.name} (eigenes)`,
    value: format.id,
  })),
])

// --- AI deck assistant (improve mode) ---------------------------------------

const { data: assistantStatus } = await useFetch<DeckAssistantStatus>('/api/assistant/status', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ enabled: false, provider: null, model: null }),
})

// --- Sharing (Phase 6) -------------------------------------------------------

// Cheap, lazily creates the profile on first read — needed only to build the
// share link (`/spieler/:handle/decks/:id`).
const { data: ownProfile } = await useFetch<OwnProfile>('/api/profile', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

const isShareOpen = ref(false)
const sharePath = computed(() => `/spieler/${ownProfile.value?.handle ?? ''}/decks/${deckId.value}`)

function onShareUpdated(visibility: Visibility) {
  if (deck.value) {
    deck.value = { ...deck.value, visibility }
  }
}

const isAssistantOpen = ref(false)
const assistantResult = ref<DeckAssistantResult | null>(null)
const isAssistantSubmitting = ref(false)
const assistantError = ref('')
const appliedChangeIndices = ref<Set<number>>(new Set())
const appliedMissingIndices = ref<Set<number>>(new Set())

async function handleAssistantSubmit(payload: AssistantRequestPayload) {
  if (isAssistantSubmitting.value) {
    return
  }

  isAssistantSubmitting.value = true
  assistantError.value = ''

  try {
    assistantResult.value = await $fetch<DeckAssistantResult>('/api/assistant/suggest', {
      method: 'POST',
      body: {
        mode: 'improve',
        deckId: deckId.value,
        playStyle: payload.playStyle,
        notes: payload.notes || undefined,
        includeMissing: payload.includeMissing,
      },
    })
    appliedChangeIndices.value = new Set()
    appliedMissingIndices.value = new Set()
  }
  catch (error) {
    assistantError.value = apiErrorMessage(error, 'Die Vorschläge konnten nicht erzeugt werden.')
  }
  finally {
    isAssistantSubmitting.value = false
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
  return entry ? CARD_STATUS_LABELS[entry.status] : null
}

function statusColorFor(catalogCardId: number) {
  const entry = cardStatusFor(catalogCardId)
  return entry?.status === 'forbidden' ? ('error' as const) : ('warning' as const)
}

const validationBadge = computed(() => {
  if (!deck.value?.format) {
    return { label: 'Kein Format gewählt', color: 'neutral' as const }
  }
  const current = validation.value
  if (!current) {
    return { label: 'Kein Format gewählt', color: 'neutral' as const }
  }
  if (current.legal) {
    return { label: 'Legal', color: 'success' as const }
  }
  const count = current.issues.length
  return {
    label: `Nicht legal – ${count} Problem${count === 1 ? '' : 'e'}`,
    color: 'error' as const,
  }
})

// reka-ui reserves the empty string for "clear selection", so the "no filter"
// options use sentinels that map back to '' (same convention as
// InventorySearchPanel).
const ALL_TYPES = '__all_types__'
const ALL_ATTRIBUTES = '__all_attributes__'

const typeItems = computed(() => [
  { label: 'Alle Typen', value: ALL_TYPES },
  ...(facets.value?.types ?? []).map(value => ({ label: value, value })),
])
const attributeItems = computed(() => [
  { label: 'Alle Attribute', value: ALL_ATTRIBUTES },
  ...(facets.value?.attributes ?? []).map(value => ({ label: value, value })),
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

const sourceCards = computed<SourceCard[]>(() => (sourceData.value?.items ?? []).map((item) => {
  const inventoryItem = item as Partial<InventorySearchItem>
  const catalogItem = item as Partial<CatalogSearchItem>
  const catalogCardId = inventoryItem.catalogCardId ?? catalogItem.id ?? 0
  return {
    catalogCardId,
    name: item.name,
    type: item.type,
    frameType: catalogItem.frameType ?? null,
    attribute: item.attribute ?? null,
    race: item.race ?? null,
    level: item.level ?? null,
    imageSmall: item.imageSmall ?? null,
    owned: inventoryItem.totalQuantity ?? ownedQuantities.value?.[String(catalogCardId)] ?? 0,
  }
}))

const sourceTotal = computed(() => sourceData.value?.total ?? 0)

// --- Deck helpers ----------------------------------------------------------

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

function sectionCountClass(section: DeckSection): string {
  const count = counts.value[section]
  if (section === 'main') {
    if (count > limits.value.mainMax) {
      return 'text-red-600'
    }
    return count < limits.value.mainMin ? 'text-amber-600' : 'text-emerald-600'
  }

  const max = section === 'extra' ? limits.value.extraMax : limits.value.sideMax
  return count > max ? 'text-red-600' : 'text-gray-500'
}

function cardMetaLine(card: { type: string, level: number | null, attribute: string | null }): string {
  return [card.type, card.level !== null ? `Stufe ${card.level}` : null, card.attribute]
    .filter(Boolean)
    .join(' · ')
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
      errorMessage.value = requestError instanceof Error
        ? requestError.message
        : 'Die Änderung konnte nicht gespeichert werden.'
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

// Applies one AI-suggested change against the deck's *current* rendered
// state (add/remove is relative, the PUT endpoint sets an absolute
// quantity) — same pattern as setQuantity above. Indices key the change
// list because AssistantChange itself carries no id of its own.
async function applyAssistantChange(change: AssistantChange, index: number) {
  if (isMutating.value || appliedChangeIndices.value.has(index)) {
    return
  }

  const current = quantityInSection(change.catalogCardId, change.section)
  const next = change.action === 'add' ? current + change.quantity : Math.max(0, current - change.quantity)
  await setQuantity(change.catalogCardId, change.section, next)
  appliedChangeIndices.value.add(index)
}

async function applyAllAssistantChanges() {
  if (!assistantResult.value) {
    return
  }
  for (const [index, change] of assistantResult.value.changes.entries()) {
    if (!appliedChangeIndices.value.has(index)) {
      await applyAssistantChange(change, index)
    }
  }
}

// Decks may contain unowned cards — any resulting shortfall is already
// shown by the deck's own card rows.
async function addMissingCardToDeck(missing: AssistantMissingCard, index: number) {
  if (isMutating.value || appliedMissingIndices.value.has(index)) {
    return
  }

  const current = quantityInSection(missing.catalogCardId, missing.section)
  await setQuantity(missing.catalogCardId, missing.section, current + missing.quantity)
  appliedMissingIndices.value.add(index)
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

function moveItemsFor(row: DeckCardRow) {
  return [DECK_SECTIONS
    .filter(section => section !== row.section)
    .map(section => ({
      label: `Nach ${DECK_SECTION_LABELS[section]}`,
      icon: 'i-lucide-arrow-right-left',
      disabled: !isSectionAllowedForCard(row, section),
      onSelect: () => moveCard(row, section),
    }))]
}

async function onDeckSaved(saved: { id: string }) {
  deck.value = await $fetch<DeckDetail>(`/api/decks/${saved.id}`)
}

async function deleteDeck() {
  if (!deck.value) {
    return
  }

  const confirmed = window.confirm(`"${deck.value.name}" wirklich löschen?`)
  if (!confirmed) {
    return
  }

  errorMessage.value = ''
  try {
    await $fetch(`/api/decks/${deckId.value}`, { method: 'DELETE' })
  }
  catch (requestError) {
    errorMessage.value = requestError instanceof Error
      ? requestError.message
      : 'Das Deck konnte nicht gelöscht werden.'
    return
  }

  await navigateTo('/decks')
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <NuxtLink
        to="/decks"
        class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        Zurück zu den Decks
      </NuxtLink>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Deck konnte nicht geladen werden"
      :description="error.message"
    />

    <div
      v-else-if="pending && !deck"
      class="space-y-4"
    >
      <USkeleton class="h-10 w-64" />
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="deck">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-semibold text-gray-900">
            {{ deck.name }}
          </h1>
          <p
            v-if="deck.description"
            class="mt-1 max-w-prose text-sm text-gray-500"
          >
            {{ deck.description }}
          </p>
          <p class="mt-1 text-sm text-gray-500">
            {{ counts.total }} Karte<span v-if="counts.total !== 1">n</span> insgesamt
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <SharingVisibilityBadge :visibility="deck.visibility" />
          <USelect
            v-model="formatSelection"
            :items="formatItems"
            :disabled="isMutating"
            class="w-56"
            aria-label="Format"
          />
          <UButton
            icon="i-lucide-share-2"
            color="neutral"
            variant="outline"
            label="Teilen"
            @click="() => { isShareOpen = true }"
          />
          <UButton
            v-if="assistantStatus?.enabled"
            icon="i-lucide-sparkles"
            color="neutral"
            variant="outline"
            label="KI-Vorschläge"
            @click="() => { isAssistantOpen = true }"
          />
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            label="Umbenennen"
            @click="() => { isFormOpen = true }"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="outline"
            label="Löschen"
            @click="deleteDeck"
          />
        </div>
      </div>

      <section class="rounded-md border border-gray-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-gray-900">
            Regelprüfung
          </h2>
          <UBadge
            :color="validationBadge.color"
            variant="subtle"
            :label="validationBadge.label"
            aria-label="Regelprüfung Status"
          />
        </div>

        <p
          v-if="!deck.format"
          class="mt-2 text-sm text-gray-500"
        >
          Wähle oben ein Format, um dieses Deck automatisch auf Legalität zu prüfen.
        </p>
        <p
          v-else-if="validation?.legal"
          class="mt-2 text-sm text-gray-500"
        >
          Das Deck erfüllt alle Regeln von "{{ deck.format.name }}".
        </p>
        <ul
          v-else
          class="mt-2 list-inside list-disc space-y-0.5 text-sm text-red-700"
        >
          <li
            v-for="(issue, index) in validation?.issues ?? []"
            :key="`${issue.code}-${issue.cardId ?? issue.section ?? index}`"
          >
            {{ issue.message }}
          </li>
        </ul>
      </section>

      <UAlert
        v-if="warnings.length > 0"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Hinweise zum Deckaufbau"
      >
        <template #description>
          <ul class="list-inside list-disc space-y-0.5">
            <li
              v-for="warning in warnings"
              :key="`${warning.code}-${warning.cardId ?? ''}`"
            >
              {{ warning.message }}
            </li>
          </ul>
        </template>
      </UAlert>

      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <div class="flex flex-col gap-6 lg:flex-row">
        <aside class="w-full shrink-0 space-y-3 lg:w-96">
          <div class="rounded-md border border-gray-200 bg-white p-4">
            <h2 class="text-base font-semibold text-gray-900">
              Aus Inventar hinzufügen
            </h2>

            <div class="mt-3 space-y-2">
              <UInput
                v-model="sourceSearch"
                icon="i-lucide-search"
                placeholder="Karte suchen..."
                aria-label="Karten für das Deck suchen"
              />
              <div class="flex gap-2">
                <USelect
                  v-model="typeSelection"
                  :items="typeItems"
                  aria-label="Typ"
                  class="flex-1"
                />
                <USelect
                  v-model="attributeSelection"
                  :items="attributeItems"
                  aria-label="Attribut"
                  class="flex-1"
                />
              </div>
              <UCheckbox
                v-model="includeCatalog"
                label="Auch Katalogkarten anzeigen"
              />
            </div>

            <p class="mt-3 text-xs text-gray-500">
              {{ sourceTotal }} Karte<span v-if="sourceTotal !== 1">n</span>
            </p>

            <div
              v-if="sourcePending"
              class="mt-3 space-y-2"
            >
              <USkeleton
                v-for="n in 3"
                :key="n"
                class="h-16 w-full"
              />
            </div>

            <p
              v-else-if="sourceCards.length === 0"
              class="mt-3 text-sm text-gray-500"
            >
              Keine Karten gefunden.
            </p>

            <ul
              v-else
              class="mt-3 divide-y divide-gray-100"
            >
              <li
                v-for="card in sourceCards"
                :key="card.catalogCardId"
                class="flex gap-3 py-3"
              >
                <img
                  v-if="card.imageSmall"
                  :src="card.imageSmall"
                  :alt="card.name"
                  class="h-16 w-11 shrink-0 rounded object-cover"
                >
                <div
                  v-else
                  class="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
                >
                  —
                </div>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-gray-900">
                    {{ card.name }}
                  </p>
                  <p class="truncate text-xs text-gray-500">
                    {{ cardMetaLine(card) }}
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
                  <p class="mt-0.5 text-xs text-gray-500">
                    Besitz: <span class="font-semibold tabular-nums">{{ card.owned }}</span>
                    · im Deck: <span class="font-semibold tabular-nums">{{ usedByCard.get(card.catalogCardId) ?? 0 }}</span>
                  </p>

                  <div class="mt-1.5 flex flex-wrap gap-1">
                    <UButton
                      v-for="section in DECK_SECTIONS"
                      :key="section"
                      size="xs"
                      :color="section === defaultSectionForCard(card) ? 'primary' : 'neutral'"
                      :variant="section === defaultSectionForCard(card) ? 'solid' : 'outline'"
                      :disabled="!isSectionAllowedForCard(card, section) || isMutating"
                      :title="isSectionAllowedForCard(card, section)
                        ? undefined
                        : `${card.name} kann nicht ins ${DECK_SECTION_LABELS[section]}`"
                      :label="`+ ${section === 'main' ? 'Main' : section === 'extra' ? 'Extra' : 'Side'}`"
                      :aria-label="`${card.name} zum ${DECK_SECTION_LABELS[section]} hinzufügen`"
                      @click="addCard(card, section)"
                    />
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </aside>

        <div class="min-w-0 flex-1 space-y-6">
          <section
            v-for="section in DECK_SECTIONS"
            :key="section"
            class="rounded-md border border-gray-200 bg-white"
          >
            <header class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 class="text-base font-semibold text-gray-900">
                {{ DECK_SECTION_LABELS[section] }}
              </h2>
              <span
                class="text-sm font-semibold tabular-nums"
                :class="sectionCountClass(section)"
                :aria-label="`Anzahl im ${DECK_SECTION_LABELS[section]}`"
              >
                {{ sectionLimitLabel(section) }}
              </span>
            </header>

            <p
              v-if="sections[section].length === 0"
              class="px-4 py-6 text-sm text-gray-500"
            >
              Noch keine Karten im {{ DECK_SECTION_LABELS[section] }}.
            </p>

            <ul
              v-else
              class="divide-y divide-gray-100"
            >
              <li
                v-for="row in sections[section]"
                :key="`${section}-${row.catalogCardId}`"
                class="flex items-center gap-3 px-4 py-2"
                :class="issueCardIds.has(row.catalogCardId) ? 'bg-red-50' : undefined"
              >
                <img
                  v-if="row.imageSmall"
                  :src="row.imageSmall"
                  :alt="row.name"
                  class="h-14 w-10 shrink-0 rounded object-cover"
                >
                <div
                  v-else
                  class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
                >
                  —
                </div>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-gray-900">
                    {{ row.name }}
                  </p>
                  <p class="truncate text-xs text-gray-500">
                    {{ cardMetaLine(row) }}
                  </p>
                  <UBadge
                    v-if="statusLabelFor(row.catalogCardId)"
                    class="mt-0.5"
                    size="sm"
                    variant="subtle"
                    :color="statusColorFor(row.catalogCardId)"
                    :label="statusLabelFor(row.catalogCardId) ?? ''"
                    :title="cardStatusFor(row.catalogCardId)?.reasons.join(' · ')"
                  />
                </div>

                <span
                  class="shrink-0 text-xs tabular-nums"
                  :class="row.shortfall > 0 ? 'font-semibold text-red-600' : 'text-gray-500'"
                  :title="row.shortfall > 0 ? `Du besitzt nur ${row.owned}` : undefined"
                >
                  {{ row.usedInDeck }}/{{ row.owned }}
                </span>

                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    icon="i-lucide-minus"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    :disabled="isMutating"
                    :aria-label="`Eine Kopie von ${row.name} aus dem ${DECK_SECTION_LABELS[section]} entfernen`"
                    @click="setQuantity(row.catalogCardId, section, row.quantity - 1)"
                  />
                  <UInput
                    :key="`${section}-${row.catalogCardId}-${inputEpoch}`"
                    :model-value="row.quantity"
                    type="number"
                    min="0"
                    size="xs"
                    class="w-16"
                    :disabled="isMutating"
                    :aria-label="`Anzahl von ${row.name} im ${DECK_SECTION_LABELS[section]}`"
                    @change="(event: Event) => onQuantityInput(row, (event.target as HTMLInputElement).value)"
                  />
                  <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    :disabled="isMutating"
                    :aria-label="`Eine Kopie von ${row.name} zum ${DECK_SECTION_LABELS[section]} hinzufügen`"
                    @click="setQuantity(row.catalogCardId, section, row.quantity + 1)"
                  />
                  <UDropdownMenu :items="moveItemsFor(row)">
                    <UButton
                      icon="i-lucide-move-right"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :disabled="isMutating"
                      :aria-label="`${row.name} verschieben`"
                    />
                  </UDropdownMenu>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    :disabled="isMutating"
                    :aria-label="`${row.name} aus dem ${DECK_SECTION_LABELS[section]} entfernen`"
                    @click="removeCard(row)"
                  />
                </div>
              </li>
            </ul>
          </section>
        </div>
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

      <USlideover
        v-model:open="isAssistantOpen"
        title="KI-Vorschläge für dieses Deck"
      >
        <template #body>
          <div class="space-y-4">
            <DecksAssistantRequestForm
              mode="improve"
              :loading="isAssistantSubmitting"
              @submit="handleAssistantSubmit"
            />

            <p
              v-if="isAssistantSubmitting"
              class="text-sm text-gray-500"
            >
              Der Assistent analysiert dein Deck … das kann bis zu einer Minute dauern.
            </p>
            <p
              v-if="assistantError"
              class="text-sm text-red-600"
            >
              {{ assistantError }}
            </p>

            <template v-if="assistantResult">
              <p class="text-sm text-gray-700">
                {{ assistantResult.summary }}
              </p>

              <UAlert
                v-if="assistantResult.warnings.length > 0"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="Hinweise"
              >
                <template #description>
                  <ul class="list-inside list-disc space-y-0.5">
                    <li
                      v-for="(warning, index) in assistantResult.warnings"
                      :key="index"
                    >
                      {{ warning }}
                    </li>
                  </ul>
                </template>
              </UAlert>

              <DecksAssistantValidationSummary
                :validation="assistantResult.validation"
                :format-name="assistantResult.formatName"
                title="Nach allen Änderungen"
              />

              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-semibold text-gray-900">
                  Vorgeschlagene Änderungen (aus deinem Inventar)
                </h3>
                <UButton
                  v-if="assistantResult.changes.length > 0"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  label="Alle übernehmen"
                  :disabled="isMutating"
                  @click="applyAllAssistantChanges"
                />
              </div>
              <p
                v-if="assistantResult.changes.length === 0"
                class="text-sm text-gray-500"
              >
                Keine Änderungen vorgeschlagen.
              </p>
              <ul
                v-else
                class="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white"
              >
                <li
                  v-for="(change, index) in assistantResult.changes"
                  :key="index"
                  class="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-900">
                      {{ change.action === 'add' ? '+' : '−' }}{{ change.quantity }}× {{ change.name }} ({{ DECK_SECTION_LABELS[change.section] }})
                    </p>
                    <p class="text-xs text-gray-500">
                      {{ change.reason }}
                    </p>
                  </div>
                  <UButton
                    size="xs"
                    :label="appliedChangeIndices.has(index) ? 'Übernommen' : 'Übernehmen'"
                    :disabled="appliedChangeIndices.has(index) || isMutating"
                    @click="applyAssistantChange(change, index)"
                  />
                </li>
              </ul>

              <h3 class="text-sm font-semibold text-gray-900">
                Fehlende Karten
              </h3>
              <p
                v-if="assistantResult.missing.length === 0"
                class="text-sm text-gray-500"
              >
                Keine fehlenden Karten.
              </p>
              <ul
                v-else
                class="divide-y divide-amber-200 rounded-md border border-amber-200 bg-amber-50"
              >
                <li
                  v-for="(missing, index) in assistantResult.missing"
                  :key="index"
                  class="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-amber-900">
                      {{ missing.quantity }}× {{ missing.name }} ({{ DECK_SECTION_LABELS[missing.section] }})
                    </p>
                    <p class="text-xs text-amber-800">
                      Besitz: {{ missing.owned }} · {{ missing.reason }}
                    </p>
                  </div>
                  <UButton
                    size="xs"
                    color="warning"
                    :label="appliedMissingIndices.has(index) ? 'Hinzugefügt' : 'Trotzdem zum Deck hinzufügen'"
                    :disabled="appliedMissingIndices.has(index) || isMutating"
                    @click="addMissingCardToDeck(missing, index)"
                  />
                </li>
              </ul>
            </template>
          </div>
        </template>
      </USlideover>
    </template>
  </div>
</template>
