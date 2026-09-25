<script setup lang="ts">
// Editor for a rule format: name, description, and a list of typed rules.
// Shared by /formats/new (create), /formats/:id (edit), and the read-only
// view of a built-in format. Every rule renders a live summary in the
// interface language from the same describer the rest of the app uses
// (`useRuleDescription`), so the editor and the deck editor can never
// describe a rule differently.

import {
  BANLIST_SOURCES,
  banlistSourceLabel,
  CARD_STATUSES,
  DEFAULT_MAX_COPIES,
  MAX_COPIES_RULE,
  RULE_FORMAT_DESCRIPTION_MAX_LENGTH,
  RULE_FORMAT_NAME_MAX_LENGTH,
  RULE_KINDS,
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
import { DECK_SECTIONS } from '~~/shared/deck-sections'
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

const { t } = useI18n()
const count = useCount()
const apiError = useApiError()
const validationText = useValidationText()
const { describeRule } = useRuleDescription()

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
    copies: String(DEFAULT_MAX_COPIES),
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
      return { kind: 'copies', maxCopies: numeric(draft.copies) ?? DEFAULT_MAX_COPIES }
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
// Bound as `|| undefined`: UFormField's `error` is Boolean|String, so '' would count as true.
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

const ruleKinds: readonly RuleKind[] = RULE_KINDS

function ruleKindLabel(kind: RuleKind): string {
  return t(`formats.ruleKind.${kind}`)
}

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
    return t('formats.rule.incomplete')
  }
}

/** An ATK/DEF range is set, so the "? never matches" hint (#140) applies. */
function hasStatRange(filter: EditableFilter): boolean {
  return [filter.atkMin, filter.atkMax, filter.defMin, filter.defMax].some(value => value !== '' && value !== null && value !== undefined)
}

function onCardsResolved(cards: Array<{ id: number, name: string }>) {
  for (const card of cards) {
    cardNames[String(card.id)] = card.name
  }
}

// --- Option lists ----------------------------------------------------------

const sectionItems = computed(() => DECK_SECTIONS.map(section => ({ label: t(`decks.section.${section}`), value: section })))
const statusItems = computed(() => CARD_STATUSES.map(status => ({ label: t(`formats.cardStatus.${status}`), value: status })))
// Banlist names are game terms (TCG, OCG, GOAT) in every language.
const sourceItems = BANLIST_SOURCES.map(source => ({ label: banlistSourceLabel(source), value: source }))
const matchItems = computed(() => [
  { label: t('formats.editor.match.matching'), value: 'matching' },
  { label: t('formats.editor.match.not_matching'), value: 'not_matching' },
])
const maxCopiesItems = computed(() => [
  { label: t('formats.cardStatus.forbidden'), value: 0 },
  { label: t('formats.cardStatus.limited'), value: 1 },
  { label: t('formats.cardStatus.semi_limited'), value: 2 },
  { label: t('formats.editor.maxCopiesAllowed'), value: 3 },
])
const effectItems = computed(() => [
  { label: t('formats.editor.effect.any'), value: 'any' },
  { label: t('formats.editor.effect.yes'), value: 'yes' },
  { label: t('formats.editor.effect.no'), value: 'no' },
])
const regionItems = computed(() => [
  { label: t('formats.editor.region.tcg'), value: 'tcg' },
  { label: t('formats.editor.region.ocg'), value: 'ocg' },
])

// --- Deck check ------------------------------------------------------------

const { data: deckList } = await useFetch<{ items: Array<{ id: string, name: string }> }>('/api/decks', {
  query: { pageSize: 60, sort: 'name' },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const deckItems = computed(() => (deckList.value?.items ?? []).map(deck => ({ label: deck.name, value: deck.id })))
const checkDeckId = ref('')
const checkResult = ref<DeckValidation | null>(null)
const checkBadgeLabel = computed(() => (checkResult.value?.legal
  ? t('validation.badge.legal')
  : count('validation.badge.notLegalCount', checkResult.value?.issues.length ?? 0)))
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
    checkError.value = apiError(error, 'formats.editor.check.failed')
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
    nameError.value = t('formats.editor.nameRequired')
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
    errorMessage.value = apiError(error, 'formats.editor.saveFailed')
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-4 panel p-4">
      <UFormField
        :label="t('formats.editor.name')"
        :error="nameError || undefined"
      >
        <UInput
          ref="nameInput"
          v-model="name"
          :maxlength="RULE_FORMAT_NAME_MAX_LENGTH"
          :disabled="readonly"
          :placeholder="t('formats.editor.namePlaceholder')"
          :aria-label="t('formats.editor.nameLabel')"
        />
      </UFormField>

      <UFormField :label="t('formats.editor.description')">
        <UTextarea
          v-model="description"
          :rows="2"
          :maxlength="RULE_FORMAT_DESCRIPTION_MAX_LENGTH"
          :disabled="readonly"
          :aria-label="t('formats.editor.descriptionLabel')"
        />
      </UFormField>
    </div>

    <div class="space-y-3 panel p-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-base font-semibold text-highlighted">
          {{ t('formats.editor.rules') }}
        </h2>
        <p class="text-sm text-muted">
          {{ count('formats.list.ruleCount', rules.length) }}
        </p>
      </div>

      <p
        v-if="rules.length === 0"
        class="text-sm text-muted"
      >
        {{ t('formats.editor.noRules') }}
      </p>

      <ul class="space-y-3">
        <li
          v-for="(rule, index) in rules"
          :key="`${rule.kind}-${index}`"
          class="rounded-lg border border-default p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                {{ ruleKindLabel(rule.kind) }}
              </p>
              <p
                class="mt-0.5 text-sm text-highlighted"
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
              :aria-label="t('formats.editor.removeRule', { index: index + 1 })"
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
              :aria-label="t('formats.editor.section')"
            />
            <UInput
              v-model="rule.min"
              type="number"
              min="0"
              class="w-28"
              :disabled="readonly"
              :placeholder="t('formats.editor.minPlaceholder')"
              :aria-label="t('formats.editor.minLabel')"
            />
            <UInput
              v-model="rule.max"
              type="number"
              min="0"
              class="w-28"
              :disabled="readonly"
              :placeholder="t('formats.editor.maxPlaceholder')"
              :aria-label="t('formats.editor.maxLabel')"
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
              :max="MAX_COPIES_RULE"
              class="w-28"
              :disabled="readonly"
              :aria-label="t('formats.editor.copiesLabel')"
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
              :aria-label="t('formats.editor.statusLabel')"
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
              :aria-label="t('formats.editor.banlistLabel')"
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
                :aria-label="t('formats.editor.matchLabel')"
              />
              <USelect
                v-model="rule.maxCopies"
                :items="maxCopiesItems"
                :disabled="readonly"
                class="w-full sm:w-48"
                :aria-label="t('formats.editor.maxCopiesLabel')"
              />
              <UInput
                v-model="rule.label"
                class="w-full sm:w-64"
                :disabled="readonly"
                :placeholder="t('formats.editor.labelPlaceholder')"
                :aria-label="t('formats.editor.labelLabel')"
              />
            </div>

            <!-- The same type/attribute/race menus as catalog and inventory (#120);
                 levels are a min/max range below, so no level menu. -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CardFacetFilters
                v-model:type="rule.filter.types"
                v-model:attribute="rule.filter.attributes"
                v-model:race="rule.filter.races"
                :facets="facets"
                :disabled="readonly"
              />
              <USelectMenu
                v-model="rule.filter.setIds"
                multiple
                value-key="value"
                :items="setItems"
                :disabled="readonly"
                :placeholder="t('formats.editor.sets')"
                :aria-label="t('formats.editor.sets')"
                class="w-full min-w-0"
              />
            </div>

            <div class="flex flex-wrap gap-3">
              <UInput
                v-model="rule.filter.levelMin"
                type="number"
                min="0"
                class="w-36"
                :disabled="readonly"
                :placeholder="t('formats.editor.levelMin')"
                :aria-label="t('formats.editor.levelMin')"
              />
              <UInput
                v-model="rule.filter.levelMax"
                type="number"
                min="0"
                class="w-36"
                :disabled="readonly"
                :placeholder="t('formats.editor.levelMax')"
                :aria-label="t('formats.editor.levelMax')"
              />
              <UInput
                v-model="rule.filter.atkMin"
                type="number"
                min="0"
                class="w-28"
                :disabled="readonly"
                :placeholder="t('formats.editor.atkMin')"
                :aria-label="t('formats.editor.atkMin')"
              />
              <UInput
                v-model="rule.filter.atkMax"
                type="number"
                min="0"
                class="w-28"
                :disabled="readonly"
                :placeholder="t('formats.editor.atkMax')"
                :aria-label="t('formats.editor.atkMax')"
              />
              <UInput
                v-model="rule.filter.defMin"
                type="number"
                min="0"
                class="w-28"
                :disabled="readonly"
                :placeholder="t('formats.editor.defMin')"
                :aria-label="t('formats.editor.defMin')"
              />
              <UInput
                v-model="rule.filter.defMax"
                type="number"
                min="0"
                class="w-28"
                :disabled="readonly"
                :placeholder="t('formats.editor.defMax')"
                :aria-label="t('formats.editor.defMax')"
              />
            </div>
            <p
              v-if="hasStatRange(rule.filter)"
              class="text-xs text-muted"
            >
              {{ t('formats.editor.unknownStatHint') }}
            </p>

            <div class="flex flex-wrap gap-3">
              <USelect
                v-model="rule.filter.hasEffect"
                :items="effectItems"
                :disabled="readonly"
                class="w-44"
                :aria-label="t('formats.editor.effectLabel')"
              />
              <UInput
                v-model="rule.filter.releasedBefore"
                type="date"
                class="w-44"
                :disabled="readonly"
                :aria-label="t('formats.editor.releasedBefore')"
              />
              <UInput
                v-model="rule.filter.releasedAfter"
                type="date"
                class="w-44"
                :disabled="readonly"
                :aria-label="t('formats.editor.releasedAfter')"
              />
              <USelect
                v-model="rule.filter.region"
                :items="regionItems"
                :disabled="readonly"
                class="w-40"
                :aria-label="t('formats.editor.regionLabel')"
              />
              <UInput
                v-model="rule.filter.nameContains"
                class="w-56"
                :disabled="readonly"
                :placeholder="t('formats.editor.nameContains')"
                :aria-label="t('formats.editor.nameContains')"
              />
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="!readonly"
        class="border-t border-default pt-3"
      >
        <p class="text-sm font-medium text-default">
          {{ t('formats.editor.addRule') }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <UButton
            v-for="kind in ruleKinds"
            :key="kind"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            size="xs"
            :label="ruleKindLabel(kind)"
            :aria-label="t('formats.editor.addRuleLabel', { kind: ruleKindLabel(kind) })"
            class="tap-target"
            @click="addRule(kind)"
          />
        </div>
      </div>
    </div>

    <div class="space-y-3 panel p-4">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('formats.editor.check.title') }}
      </h2>
      <p class="text-sm text-muted">
        {{ t('formats.editor.check.description') }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-model="checkDeckId"
          :items="deckItems"
          class="w-64"
          :placeholder="t('formats.editor.check.deckPlaceholder')"
          :aria-label="t('formats.editor.check.deckLabel')"
        />
        <UButton
          icon="i-lucide-shield-check"
          color="neutral"
          variant="outline"
          :label="t('formats.editor.check.button')"
          :loading="isChecking"
          :disabled="!checkDeckId"
          @click="runDeckCheck"
        />
      </div>

      <p
        v-if="checkError"
        class="text-sm text-error"
      >
        {{ checkError }}
      </p>

      <div v-if="checkResult">
        <UBadge
          :color="checkResult.legal ? 'success' : 'error'"
          variant="subtle"
          :label="checkBadgeLabel"
        />
        <ul class="mt-2 list-inside list-disc space-y-0.5 text-sm text-default">
          <li
            v-for="(issue, index) in checkResult.issues"
            :key="`${issue.code}-${issue.cardId ?? index}`"
          >
            {{ validationText(issue) }}
          </li>
        </ul>
      </div>
    </div>

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-error"
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
        :label="isEditing ? t('common.save') : t('formats.editor.create')"
        @click="save"
      />
    </div>
  </div>
</template>
