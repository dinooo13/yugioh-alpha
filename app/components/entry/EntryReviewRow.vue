<script setup lang="ts">
import {
  DEFAULT_VALUE,
  MAX_ENTRY_QUANTITY,
  ENTRY_CONDITION_ITEMS,
  ENTRY_EDITION_ITEMS,
  ENTRY_LANGUAGE_ITEMS,
  ENTRY_MATCHED_BY_LABELS,
  NO_COLLECTION_VALUE,
  NO_PRINTING_VALUE,
  effectiveValuesLabel,
  entryRowStatus,
  selectedCandidate,
} from '~/utils/card-entry'
import type { EntryCandidate, EntryDefaults, EntryRow } from '~/utils/card-entry'

interface PickedCatalogCard {
  id: number
  name: string
  type: string
  imageUrlSmall: string | null
  printings: Array<{ id: string, cardId: number, setName: string, rarity: string | null }>
}

const props = defineProps<{
  row: EntryRow
  defaults: EntryDefaults
  collections: Array<{ id: string, name: string }>
}>()

const emit = defineEmits<{
  update: [patch: Partial<EntryRow>]
  remove: []
}>()

const isPickerOpen = ref(false)
const showOverrides = ref(false)

const status = computed(() => entryRowStatus(props.row))
const selected = computed(() => selectedCandidate(props.row))

const statusMeta = computed(() => {
  switch (status.value) {
    case 'sicher':
      return { label: 'Sicher', color: 'success' as const }
    case 'unsicher':
      return { label: 'Unsicher', color: 'warning' as const }
    default:
      return { label: 'Kein Treffer', color: 'error' as const }
  }
})

const candidateItems = computed(() => props.row.candidates.map(candidate => ({
  label: `${candidate.name} · ${ENTRY_MATCHED_BY_LABELS[candidate.matchedBy]} ${Math.round(candidate.score * 100)}%`,
  value: String(candidate.cardId),
})))

const candidateValue = computed({
  get: () => props.row.selectedCardId === null ? undefined : String(props.row.selectedCardId),
  set: (value: string | undefined) => {
    const cardId = value === undefined ? null : Number(value)
    const candidate = props.row.candidates.find(entry => entry.cardId === cardId)
    emit('update', {
      selectedCardId: cardId,
      printingId: candidate?.printings.find(
        printing => printing.setCode.toLowerCase() === (props.row.setCode ?? '').toLowerCase(),
      )?.id ?? null,
      // The user just decided which card this line is.
      conflict: false,
    })
  },
})

const printingItems = computed(() => [
  { label: 'Keine bestimmte Edition', value: NO_PRINTING_VALUE },
  ...(selected.value?.printings ?? []).map(printing => ({
    label: `${printing.setCode}${printing.setName ? ` · ${printing.setName}` : ''}${printing.rarity ? ` · ${printing.rarity}` : ''}`,
    value: printing.id,
  })),
])

const printingValue = computed({
  get: () => props.row.printingId ?? NO_PRINTING_VALUE,
  set: (value: string) => emit('update', { printingId: value === NO_PRINTING_VALUE ? null : value }),
})

const quantityValue = computed({
  get: () => props.row.quantity,
  set: (value: number) => emit('update', {
    quantity: Math.min(MAX_ENTRY_QUANTITY, Math.max(1, Math.floor(Number(value) || 1))),
  }),
})

function overrideItems(items: Array<{ label: string, value: string }>) {
  return [{ label: 'Standard', value: DEFAULT_VALUE }, ...items]
}

const collectionItems = computed(() => [
  { label: 'Standard', value: DEFAULT_VALUE },
  { label: '— (keine)', value: NO_COLLECTION_VALUE },
  ...props.collections.map(collection => ({ label: collection.name, value: collection.id })),
])

function overrideValue(key: 'language' | 'condition' | 'edition' | 'collectionId') {
  return computed({
    get: () => props.row[key] ?? DEFAULT_VALUE,
    set: (value: string) => emit('update', { [key]: value === DEFAULT_VALUE ? null : value }),
  })
}

const languageOverride = overrideValue('language')
const conditionOverride = overrideValue('condition')
const editionOverride = overrideValue('edition')
const collectionOverride = overrideValue('collectionId')

const valuesLabel = computed(() => effectiveValuesLabel(props.row, props.defaults))

function onPicked(card: PickedCatalogCard) {
  const candidate: EntryCandidate = {
    cardId: card.id,
    name: card.name,
    type: card.type,
    frameType: null,
    imageSmall: card.imageUrlSmall ?? null,
    score: 1,
    matchedBy: 'exact',
    // The catalog picker's printing id is the set code (see
    // docs/adr/0001 — `catalog_printing.id` *is* the full set code).
    printings: (card.printings ?? []).map(printing => ({
      id: printing.id,
      setCode: printing.id,
      setName: printing.setName,
      rarity: printing.rarity,
    })),
  }

  emit('update', {
    candidates: [candidate, ...props.row.candidates.filter(entry => entry.cardId !== candidate.cardId)],
    selectedCardId: candidate.cardId,
    printingId: null,
    // The parsed set code belonged to the old guess, not to the card the
    // user just pointed this row at.
    setCode: null,
    conflict: false,
  })
  isPickerOpen.value = false
}
</script>

<template>
  <div
    class="space-y-3 p-4"
    :data-status="status"
  >
    <div class="flex items-start gap-3">
      <CardThumb
        :src="selected?.imageSmall"
        :alt="selected?.name ?? row.query"
        size="sm"
      />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusMeta.color"
            variant="subtle"
            :label="statusMeta.label"
          />
          <span class="truncate font-mono text-xs text-gray-500">{{ row.raw }}</span>
          <UBadge
            v-if="row.setCode"
            color="neutral"
            variant="subtle"
            :label="row.setCode"
          />
        </div>
        <p class="mt-1 truncate text-sm font-medium text-gray-900">
          {{ selected ? selected.name : 'Kein Treffer' }}
        </p>
        <p class="truncate text-xs text-gray-500">
          <span v-if="selected">{{ selected.type }} · </span>{{ valuesLabel }}
        </p>
        <p
          v-if="row.conflict"
          class="mt-1 text-xs text-amber-700"
        >
          Set-Code und Name zeigen auf verschiedene Karten — bitte auswählen.
        </p>
      </div>

      <UFormField
        label="Anzahl"
        size="xs"
        class="w-20 shrink-0"
      >
        <UInput
          v-model.number="quantityValue"
          type="number"
          min="1"
          :max="MAX_ENTRY_QUANTITY"
          :aria-label="`Anzahl für ${row.raw}`"
        />
      </UFormField>

      <div class="flex shrink-0 gap-1">
        <UButton
          icon="i-lucide-sliders-horizontal"
          color="neutral"
          variant="ghost"
          :aria-label="`Werte für ${row.raw} anpassen`"
          class="tap-target"
          @click="() => { showOverrides = !showOverrides }"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :aria-label="`${row.raw} entfernen`"
          class="tap-target"
          @click="emit('remove')"
        />
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-[2fr_2fr_auto]">
      <USelect
        v-if="row.candidates.length > 0"
        v-model="candidateValue"
        :items="candidateItems"
        placeholder="Treffer auswählen..."
        :aria-label="`Treffer für ${row.raw}`"
      />
      <p
        v-else
        class="self-center text-xs text-gray-500"
      >
        Keine Vorschläge — bitte im Katalog suchen.
      </p>

      <USelect
        v-model="printingValue"
        :items="printingItems"
        :disabled="!selected"
        :aria-label="`Printing für ${row.raw}`"
      />

      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="outline"
        label="Katalog"
        @click="() => { isPickerOpen = true }"
      />
    </div>

    <div
      v-if="showOverrides"
      class="grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-4"
    >
      <UFormField label="Sprache">
        <USelect
          v-model="languageOverride"
          :items="overrideItems(ENTRY_LANGUAGE_ITEMS)"
        />
      </UFormField>
      <UFormField label="Zustand">
        <USelect
          v-model="conditionOverride"
          :items="overrideItems(ENTRY_CONDITION_ITEMS)"
        />
      </UFormField>
      <UFormField label="Edition">
        <USelect
          v-model="editionOverride"
          :items="overrideItems(ENTRY_EDITION_ITEMS)"
        />
      </UFormField>
      <UFormField label="Sammlung">
        <USelect
          v-model="collectionOverride"
          :items="collectionItems"
        />
      </UFormField>
    </div>

    <UModal
      v-model:open="isPickerOpen"
      title="Karte aus dem Katalog wählen"
    >
      <template #body>
        <InventoryCatalogCardPicker @select="onPicked" />
      </template>
    </UModal>
  </div>
</template>
