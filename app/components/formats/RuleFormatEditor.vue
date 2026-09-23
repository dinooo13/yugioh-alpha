<script setup lang="ts">
// Editor for a rule format: name, description, and a list of typed rules.
// Shared by /formate/neu (create), /formate/:id (edit), and the read-only
// view of a built-in format. Every rule renders a live German summary from
// the same `describeRule` the rest of the app uses, so the editor and the
// deck validation can never describe a rule differently.

import {
  CARD_STATUSES,
  describeRule,
  RULE_FORMAT_DESCRIPTION_MAX_LENGTH,
  RULE_FORMAT_NAME_MAX_LENGTH,
  RULE_KIND_LABELS,
} from '~~/shared/rule-formats'
import type {
  BanlistSource,
  CardFilter,
  CardStatusName,
  DeckValidation,
  FilterMatch,
  Rule,
  RuleKind,
  RuleSet,
} from '~~/shared/rule-formats'
import { DECK_SECTION_LABELS, DECK_SECTIONS } from '~~/shared/deck-sections'
import { pluralize } from '~~/shared/plural'
import type { DeckSection } from '~~/shared/deck-sections'

interface FormatInitialValues {
  id?: string
  name: string
  description: string | null
  rules: RuleSet
  cardNames?: Record<string, string>
  isBuiltin?: boolean
}

const props = defineProps<{
  initialValues?: FormatInitialValues | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  saved: [format: { id: string, name: string }]
}>()

// --- Editable rule shape ---------------------------------------------------
//
// The stored `Rule` union is a poor fit for two-way form bindings (missing
// keys, numbers arriving as strings from number inputs), so the editor keeps
// a flat, always-complete draft per rule and converts on save.

// UInput binds strings even with type="number"; '' is the empty value.
type NumberField = string

interface EditableFilter {
  types: string[]
  attributes: string[]
  races: string[]
  setIds: string[]
  levelMin: NumberField
  levelMax: NumberField
  atkMin: NumberField
  atkMax: NumberField
  defMin: NumberField
  defMax: NumberField
  hasEffect: 'any' | 'yes' | 'no'
  releasedBefore: string
  releasedAfter: string
  region: 'tcg' | 'ocg'
  nameContains: string
}

interface EditableRule {
  kind: RuleKind
  section: DeckSection
  min: NumberField
  max: NumberField
  copies: NumberField
  status: CardStatusName
  cardIds: number[]
  source: BanlistSource
  match: FilterMatch
  maxCopies: number
  label: string
  filter: EditableFilter
}

function emptyFilter(): EditableFilter {
  return {
    types: [],
    attributes: [],
    races: [],
    setIds: [],
    levelMin: '',
    levelMax: '',
    atkMin: '',
    atkMax: '',
    defMin: '',
    defMax: '',
    hasEffect: 'any',
    releasedBefore: '',
    releasedAfter: '',
    region: 'tcg',
    nameContains: '',
  }
}

function emptyRule(kind: RuleKind): EditableRule {
  return {
    kind,
    section: 'main',
    min: kind === 'deck_size' ? '40' : '',
    max: kind === 'deck_size' ? '60' : '',
    copies: '3',
    status: 'forbidden',
    cardIds: [],
    source: 'tcg',
    match: 'matching',
    maxCopies: 0,
    label: '',
    filter: emptyFilter(),
  }
}

function numeric(value: NumberField): number | undefined {
  if (value === '' || value === null || value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function numberField(value: number | undefined): NumberField {
  return value === undefined ? '' : String(value)
}

function toEditable(rule: Rule): EditableRule {
  const draft = emptyRule(rule.kind)

  switch (rule.kind) {
    case 'deck_size':
      draft.section = rule.section
      draft.min = rule.min === undefined ? '' : String(rule.min)
      draft.max = rule.max === undefined ? '' : String(rule.max)
      break
    case 'copies':
      draft.copies = String(rule.maxCopies)
      break
    case 'card_status':
      draft.status = rule.status
      draft.cardIds = [...rule.cardIds]
      break
    case 'banlist':
      draft.source = rule.source
      break
    case 'filter': {
      draft.match = rule.match
      draft.maxCopies = rule.maxCopies
      draft.label = rule.label ?? ''
      const filter = rule.filter
      draft.filter = {
        ...emptyFilter(),
        types: filter.types ?? [],
        attributes: filter.attributes ?? [],
        races: filter.races ?? [],
        setIds: filter.setIds ?? [],
        levelMin: numberField(filter.levelMin),
        levelMax: numberField(filter.levelMax),
        atkMin: numberField(filter.atkMin),
        atkMax: numberField(filter.atkMax),
        defMin: numberField(filter.defMin),
        defMax: numberField(filter.defMax),
        hasEffect: filter.hasEffect === undefined ? 'any' : filter.hasEffect ? 'yes' : 'no',
        releasedBefore: filter.releasedBefore ?? '',
        releasedAfter: filter.releasedAfter ?? '',
        region: filter.region ?? 'tcg',
        nameContains: filter.nameContains ?? '',
      }
      break
    }
  }

  return draft
}

function toCardFilter(draft: EditableFilter): CardFilter {
  const filter: CardFilter = {}

  if (draft.types.length > 0) {
    filter.types = [...draft.types]
  }
  if (draft.attributes.length > 0) {
    filter.attributes = [...draft.attributes]
  }
  if (draft.races.length > 0) {
    filter.races = [...draft.races]
  }
  if (draft.setIds.length > 0) {
    filter.setIds = [...draft.setIds]
  }

  const ranges = ['levelMin', 'levelMax', 'atkMin', 'atkMax', 'defMin', 'defMax'] as const
  for (const key of ranges) {
    const value = numeric(draft[key])
    if (value !== undefined) {
      filter[key] = value
    }
  }

  if (draft.hasEffect !== 'any') {
    filter.hasEffect = draft.hasEffect === 'yes'
  }
  if (draft.releasedBefore) {
    filter.releasedBefore = draft.releasedBefore
  }
  if (draft.releasedAfter) {
    filter.releasedAfter = draft.releasedAfter
  }
  if (draft.releasedBefore || draft.releasedAfter) {
    filter.region = draft.region
  }
  if (draft.nameContains.trim()) {
    filter.nameContains = draft.nameContains.trim()
  }

  return filter
}

function toRule(draft: EditableRule): Rule {
  switch (draft.kind) {
    case 'deck_size': {
      const rule: Rule = { kind: 'deck_size', section: draft.section }
      const min = numeric(draft.min)
      const max = numeric(draft.max)
      if (min !== undefined) {
        rule.min = min
      }
      if (max !== undefined) {
        rule.max = max
      }
      return rule
    }
    case 'copies':
      return { kind: 'copies', maxCopies: numeric(draft.copies) ?? 3 }
    case 'card_status':
      return { kind: 'card_status', status: draft.status, cardIds: [...draft.cardIds] }
    case 'banlist':
      return { kind: 'banlist', source: draft.source }
    case 'filter': {
      const rule: Rule = {
        kind: 'filter',
        match: draft.match,
        filter: toCardFilter(draft.filter),
        maxCopies: (draft.maxCopies ?? 0) as 0 | 1 | 2 | 3,
      }
      if (draft.label.trim()) {
        rule.label = draft.label.trim()
      }
      return rule
    }
  }
}

// --- State -----------------------------------------------------------------

const name = ref(props.initialValues?.name ?? '')
const description = ref(props.initialValues?.description ?? '')
const rules = ref<EditableRule[]>((props.initialValues?.rules?.rules ?? []).map(toEditable))
const cardNames = reactive<Record<string, string>>({ ...(props.initialValues?.cardNames ?? {}) })

// The name check belongs to its UFormField (aria-describedby/aria-invalid);
// errorMessage is for the server's answer.
const nameError = ref('')
const errorMessage = ref('')
const isSaving = ref(false)
const nameInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('nameInput')

watch(name, (value) => {
  if (value.trim()) {
    nameError.value = ''
  }
})

const isEditing = computed(() => Boolean(props.initialValues?.id))

const { data: facets } = await useFetch<{
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  sets: Array<{ id: string, name: string }>
}>('/api/catalog/facets', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ types: [], attributes: [], races: [], levels: [], sets: [] }),
})

const setItems = computed(() => (facets.value?.sets ?? []).map(set => ({ label: set.name, value: set.id })))
const setNames = computed(() => Object.fromEntries((facets.value?.sets ?? []).map(set => [set.id, set.name])))

// --- Rule list -------------------------------------------------------------

const ruleKinds = Object.keys(RULE_KIND_LABELS) as RuleKind[]

function addRule(kind: RuleKind) {
  rules.value = [...rules.value, emptyRule(kind)]
}

function removeRule(index: number) {
  rules.value = rules.value.filter((_, position) => position !== index)
}

function summaryFor(draft: EditableRule): string {
  try {
    return describeRule(toRule(draft), { cardNames, setNames: setNames.value })
  }
  catch {
    return 'Regel unvollständig'
  }
}

function onCardsResolved(cards: Array<{ id: number, name: string }>) {
  for (const card of cards) {
    cardNames[String(card.id)] = card.name
  }
}

// --- Option lists ----------------------------------------------------------

const sectionItems = DECK_SECTIONS.map(section => ({ label: DECK_SECTION_LABELS[section], value: section }))
const statusItems = CARD_STATUSES.map(status => ({
  label: status === 'forbidden' ? 'Verboten' : status === 'limited' ? 'Limitiert (1)' : 'Semi-limitiert (2)',
  value: status,
}))
const sourceItems = [
  { label: 'TCG', value: 'tcg' },
  { label: 'OCG', value: 'ocg' },
  { label: 'GOAT', value: 'goat' },
]
const matchItems = [
  { label: 'Karten, auf die der Filter passt', value: 'matching' },
  { label: 'Karten, auf die der Filter nicht passt', value: 'not_matching' },
]
const maxCopiesItems = [
  { label: 'Verboten', value: 0 },
  { label: 'Limitiert (1)', value: 1 },
  { label: 'Semi-limitiert (2)', value: 2 },
  { label: 'Erlaubt (3)', value: 3 },
]
const effectItems = [
  { label: 'Egal', value: 'any' },
  { label: 'Mit Effekt', value: 'yes' },
  { label: 'Ohne Effekt', value: 'no' },
]
const regionItems = [
  { label: 'TCG-Datum', value: 'tcg' },
  { label: 'OCG-Datum', value: 'ocg' },
]

// --- Deck check ------------------------------------------------------------

const { data: deckList } = await useFetch<{ items: Array<{ id: string, name: string }> }>('/api/decks', {
  query: { pageSize: 60, sort: 'name' },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const deckItems = computed(() => (deckList.value?.items ?? []).map(deck => ({ label: deck.name, value: deck.id })))
const checkDeckId = ref('')
const checkResult = ref<DeckValidation | null>(null)
const checkError = ref('')
const isChecking = ref(false)

async function runDeckCheck() {
  if (!checkDeckId.value) {
    return
  }

  isChecking.value = true
  checkError.value = ''
  checkResult.value = null

  try {
    const response = await $fetch<{ validation: DeckValidation }>('/api/formats/validate', {
      method: 'POST',
      body: { deckId: checkDeckId.value, rules: { rules: rules.value.map(toRule) } },
    })
    checkResult.value = response.validation
  }
  catch (error) {
    checkError.value = error instanceof Error ? error.message : 'Die Prüfung ist fehlgeschlagen.'
  }
  finally {
    isChecking.value = false
  }
}

// --- Save ------------------------------------------------------------------

/** The exact body sent to the API. */
function payload() {
  return {
    name: name.value.trim(),
    description: description.value.trim() || null,
    rules: { rules: rules.value.map(toRule) },
  }
}

async function save() {
  if (!name.value.trim()) {
    nameError.value = 'Bitte einen Namen angeben.'
    // The field sits far above the save button on a long rule list.
    nameInput.value?.inputRef?.focus()
    return
  }

  isSaving.value = true
  errorMessage.value = ''

  try {
    const formatId = props.initialValues?.id
    const saved = formatId
      ? await $fetch<{ id: string, name: string }>(`/api/formats/${formatId}`, { method: 'PATCH', body: payload() })
      : await $fetch<{ id: string, name: string }>('/api/formats', { method: 'POST', body: payload() })

    emit('saved', saved)
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Das Format konnte nicht gespeichert werden.'
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-4 rounded-md border border-gray-200 bg-white p-4">
      <UFormField
        label="Name"
        :error="nameError"
      >
        <UInput
          ref="nameInput"
          v-model="name"
          :maxlength="RULE_FORMAT_NAME_MAX_LENGTH"
          :disabled="readonly"
          placeholder="z. B. Nur alte Karten"
          aria-label="Formatname"
        />
      </UFormField>

      <UFormField label="Beschreibung (optional)">
        <UTextarea
          v-model="description"
          :rows="2"
          :maxlength="RULE_FORMAT_DESCRIPTION_MAX_LENGTH"
          :disabled="readonly"
          aria-label="Formatbeschreibung"
        />
      </UFormField>
    </div>

    <div class="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-base font-semibold text-gray-900">
          Regeln
        </h2>
        <p class="text-sm text-gray-500">
          {{ rules.length }} Regel<span v-if="rules.length !== 1">n</span>
        </p>
      </div>

      <p
        v-if="rules.length === 0"
        class="text-sm text-gray-500"
      >
        Noch keine Regeln. Ohne Regeln ist jedes Deck legal.
      </p>

      <ul class="space-y-3">
        <li
          v-for="(rule, index) in rules"
          :key="`${rule.kind}-${index}`"
          class="rounded-md border border-gray-200 p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {{ RULE_KIND_LABELS[rule.kind] }}
              </p>
              <p
                class="mt-0.5 text-sm text-gray-900"
                :data-testid="`rule-summary-${index}`"
              >
                {{ summaryFor(rule) }}
              </p>
            </div>
            <UButton
              v-if="!readonly"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="`Regel ${index + 1} entfernen`"
              class="tap-target"
              @click="removeRule(index)"
            />
          </div>

          <!-- deck_size -->
          <div
            v-if="rule.kind === 'deck_size'"
            class="mt-3 flex flex-wrap gap-3"
          >
            <USelect
              v-model="rule.section"
              :items="sectionItems"
              :disabled="readonly"
              class="w-44"
              aria-label="Deckbereich"
            />
            <UInput
              v-model="rule.min"
              type="number"
              min="0"
              class="w-28"
              :disabled="readonly"
              placeholder="min"
              aria-label="Mindestanzahl"
            />
            <UInput
              v-model="rule.max"
              type="number"
              min="0"
              class="w-28"
              :disabled="readonly"
              placeholder="max"
              aria-label="Höchstanzahl"
            />
          </div>

          <!-- copies -->
          <div
            v-else-if="rule.kind === 'copies'"
            class="mt-3"
          >
            <UInput
              v-model="rule.copies"
              type="number"
              min="1"
              max="10"
              class="w-28"
              :disabled="readonly"
              aria-label="Kopien pro Karte"
            />
          </div>

          <!-- card_status -->
          <div
            v-else-if="rule.kind === 'card_status'"
            class="mt-3 space-y-3"
          >
            <USelect
              v-model="rule.status"
              :items="statusItems"
              :disabled="readonly"
              class="w-52"
              aria-label="Status"
            />
            <FormatsCardStatusPicker
              v-model="rule.cardIds"
              :card-names="cardNames"
              :disabled="readonly"
              @resolved="onCardsResolved"
            />
          </div>

          <!-- banlist -->
          <div
            v-else-if="rule.kind === 'banlist'"
            class="mt-3"
          >
            <USelect
              v-model="rule.source"
              :items="sourceItems"
              :disabled="readonly"
              class="w-44"
              aria-label="Banliste"
            />
          </div>

          <!-- filter -->
          <div
            v-else-if="rule.kind === 'filter'"
            class="mt-3 space-y-3"
          >
            <div class="flex flex-wrap gap-3">
              <USelect
                v-model="rule.match"
                :items="matchItems"
                :disabled="readonly"
                class="w-full sm:w-72"
                aria-label="Filterrichtung"
              />
              <USelect
                v-model="rule.maxCopies"
                :items="maxCopiesItems"
                :disabled="readonly"
                class="w-full sm:w-48"
                aria-label="Erlaubte Kopien"
              />
              <UInput
                v-model="rule.label"
                class="w-full sm:w-64"
                :disabled="readonly"
                placeholder="Bezeichnung (optional)"
                aria-label="Regelbezeichnung"
              />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <USelectMenu
                v-model="rule.filter.types"
                multiple
                :items="facets.types"
                :disabled="readonly"
                placeholder="Kartentypen"
                aria-label="Kartentypen"
                class="w-full min-w-0"
              />
              <USelectMenu
                v-model="rule.filter.attributes"
                multiple
                :items="facets.attributes"
                :disabled="readonly"
                placeholder="Attribute"
                aria-label="Attribute"
                class="w-full min-w-0"
              />
              <USelectMenu
                v-model="rule.filter.races"
                multiple
                :items="facets.races"
                :disabled="readonly"
                placeholder="Arten"
                aria-label="Arten"
                class="w-full min-w-0"
              />
              <USelectMenu
                v-model="rule.filter.setIds"
                multiple
                value-key="value"
                :items="setItems"
                :disabled="readonly"
                placeholder="Sets"
                aria-label="Sets"
                class="w-full min-w-0"
              />
            </div>

            <div class="flex flex-wrap gap-3">
              <UInput
                v-model="rule.filter.levelMin"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="Stufe ab"
                aria-label="Stufe ab"
              />
              <UInput
                v-model="rule.filter.levelMax"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="Stufe bis"
                aria-label="Stufe bis"
              />
              <UInput
                v-model="rule.filter.atkMin"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="ATK ab"
                aria-label="ATK ab"
              />
              <UInput
                v-model="rule.filter.atkMax"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="ATK bis"
                aria-label="ATK bis"
              />
              <UInput
                v-model="rule.filter.defMin"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="DEF ab"
                aria-label="DEF ab"
              />
              <UInput
                v-model="rule.filter.defMax"
                type="number"
                class="w-28"
                :disabled="readonly"
                placeholder="DEF bis"
                aria-label="DEF bis"
              />
            </div>

            <div class="flex flex-wrap gap-3">
              <USelect
                v-model="rule.filter.hasEffect"
                :items="effectItems"
                :disabled="readonly"
                class="w-44"
                aria-label="Effekt"
              />
              <UInput
                v-model="rule.filter.releasedBefore"
                type="date"
                class="w-44"
                :disabled="readonly"
                aria-label="Erschienen vor"
              />
              <UInput
                v-model="rule.filter.releasedAfter"
                type="date"
                class="w-44"
                :disabled="readonly"
                aria-label="Erschienen nach"
              />
              <USelect
                v-model="rule.filter.region"
                :items="regionItems"
                :disabled="readonly"
                class="w-40"
                aria-label="Region"
              />
              <UInput
                v-model="rule.filter.nameContains"
                class="w-56"
                :disabled="readonly"
                placeholder="Name enthält"
                aria-label="Name enthält"
              />
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="!readonly"
        class="border-t border-gray-200 pt-3"
      >
        <p class="text-sm font-medium text-gray-700">
          Regel hinzufügen
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <UButton
            v-for="kind in ruleKinds"
            :key="kind"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            size="xs"
            :label="RULE_KIND_LABELS[kind]"
            :aria-label="`Regel hinzufügen: ${RULE_KIND_LABELS[kind]}`"
            class="tap-target"
            @click="addRule(kind)"
          />
        </div>
      </div>
    </div>

    <div class="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <h2 class="text-base font-semibold text-gray-900">
        Deck prüfen
      </h2>
      <p class="text-sm text-gray-500">
        Prüft eines deiner Decks gegen die Regeln in diesem Editor — auch ungespeichert.
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-model="checkDeckId"
          :items="deckItems"
          class="w-64"
          placeholder="Deck wählen"
          aria-label="Deck für die Prüfung"
        />
        <UButton
          icon="i-lucide-shield-check"
          color="neutral"
          variant="outline"
          label="Deck prüfen"
          :loading="isChecking"
          :disabled="!checkDeckId"
          @click="runDeckCheck"
        />
      </div>

      <p
        v-if="checkError"
        class="text-sm text-red-600"
      >
        {{ checkError }}
      </p>

      <div v-if="checkResult">
        <UBadge
          :color="checkResult.legal ? 'success' : 'error'"
          variant="subtle"
          :label="checkResult.legal ? 'Legal' : `Nicht legal – ${pluralize(checkResult.issues.length, 'Problem', 'Probleme')}`"
        />
        <ul class="mt-2 list-inside list-disc space-y-0.5 text-sm text-gray-700">
          <li
            v-for="(issue, index) in checkResult.issues"
            :key="`${issue.code}-${issue.cardId ?? index}`"
          >
            {{ issue.message }}
          </li>
        </ul>
      </div>
    </div>

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="!readonly"
      class="flex justify-end gap-2"
    >
      <UButton
        icon="i-lucide-save"
        :loading="isSaving"
        :label="isEditing ? 'Speichern' : 'Format erstellen'"
        @click="save"
      />
    </div>
  </div>
</template>
