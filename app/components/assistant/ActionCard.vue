<script setup lang="ts">
import { ASSISTANT_ACTION_KIND_LABELS, ASSISTANT_ACTION_STATUS_LABELS } from '~~/shared/assistant-chat'
import type { AssistantActionView } from '~~/shared/assistant-chat'
import { DECK_SECTION_LABELS } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import { apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  action: AssistantActionView
}>()

const emit = defineEmits<{
  updated: [action: AssistantActionView]
}>()

const isExpanded = ref(false)
const isApplying = ref(false)
const isRejecting = ref(false)
const errorMessage = ref('')

const statusColor = computed(() => {
  switch (props.action.status) {
    case 'applied':
      return 'success' as const
    case 'rejected':
      return 'neutral' as const
    case 'failed':
      return 'error' as const
    default:
      return 'warning' as const
  }
})

// Payload fields the write tools actually produce (server/utils/assistant-tools.ts) —
// only these are ever shown, whichever of them a given action kind carries.
const FIELD_LABELS: Record<string, string> = {
  name: 'Karte',
  catalogCardId: 'Karte (ID)',
  quantity: 'Menge',
  section: 'Sektion',
  collectionId: 'Sammlung',
  language: 'Sprache',
  condition: 'Zustand',
  edition: 'Auflage',
  printingId: 'Druck',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rowsOf(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of ['items', 'cards', 'changes']) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value.filter(isPlainObject)
    }
  }
  return []
}

const rows = computed(() => rowsOf(props.action.payload))

const columns = computed(() => {
  const keys: string[] = []
  for (const key of Object.keys(FIELD_LABELS)) {
    if (rows.value.some(row => row[key] !== null && row[key] !== undefined)) {
      keys.push(key)
    }
  }
  // Deck rows carry the card's name (ADR 0011) — the bare catalog id next to
  // it is noise. Older actions without names still show the id.
  return keys.includes('name') ? keys.filter(key => key !== 'catalogCardId') : keys
})

function columnLabel(column: string): string {
  // update_deck_cards' quantity is the new absolute amount, not a delta.
  if (column === 'quantity' && props.action.kind === 'update_deck_cards') {
    return 'Neue Menge'
  }
  return FIELD_LABELS[column] ?? column
}

// --- Proposal preview (create_deck / update_deck_cards / set_deck_format, ADR 0011) ---

interface DeckPreview {
  counts: { main: number, extra: number, side: number }
  validation: { legal: boolean, issues: string[] } | null
  missing: Array<{ catalogCardId: number, name: string, needed: number, owned: number }>
}

const PREVIEW_ISSUES_SHOWN = 5

/** `payload.preview`, if the action carries a well-formed one (older actions don't). */
const preview = computed<DeckPreview | null>(() => {
  const raw = props.action.payload.preview
  if (!isPlainObject(raw) || !isPlainObject(raw.counts) || !Array.isArray(raw.missing)) {
    return null
  }
  const counts = raw.counts as Record<string, unknown>
  const validation = isPlainObject(raw.validation) ? raw.validation : null
  return {
    counts: { main: Number(counts.main) || 0, extra: Number(counts.extra) || 0, side: Number(counts.side) || 0 },
    validation: validation
      ? {
          legal: validation.legal === true,
          issues: Array.isArray(validation.issues) ? validation.issues.filter((issue): issue is string => typeof issue === 'string') : [],
        }
      : null,
    missing: raw.missing.filter(isPlainObject).map(card => ({
      catalogCardId: Number(card.catalogCardId),
      name: String(card.name ?? ''),
      needed: Number(card.needed) || 0,
      owned: Number(card.owned) || 0,
    })),
  }
})

const legalityBadge = computed(() => {
  const validation = preview.value?.validation
  if (!validation) {
    return { color: 'neutral' as const, label: 'Kein Format' }
  }
  if (validation.legal) {
    return { color: 'success' as const, label: 'Legal' }
  }
  const count = validation.issues.length
  return { color: 'error' as const, label: `Nicht legal – ${count} ${count === 1 ? 'Problem' : 'Probleme'}` }
})

// An applied create_deck / set_deck_format stores the (new or updated) deck's
// detail as its result — link to it.
const openDeckId = computed(() => {
  const { kind, status } = props.action
  if ((kind !== 'create_deck' && kind !== 'set_deck_format') || status !== 'applied') {
    return null
  }
  const result = props.action.result
  return isPlainObject(result) && typeof result.id === 'string' ? result.id : null
})

function displayValue(column: string, value: unknown): string {
  if (column === 'section' && typeof value === 'string' && value in DECK_SECTION_LABELS) {
    return DECK_SECTION_LABELS[value as DeckSection]
  }
  return String(value)
}

// Top-level scalars worth showing above the row table (e.g. create_deck's
// name/formatId, update_deck_cards' deckId, set_deck_format's old/new format)
// — arrays are rendered as rows instead, everything else in the payload is
// internal detail.
const metaEntries = computed(() => {
  const entries: Array<{ label: string, value: string }> = []
  const payload = props.action.payload
  if (typeof payload.name === 'string') {
    entries.push({ label: 'Name', value: payload.name })
  }
  if (typeof payload.deckName === 'string' || typeof payload.deckId === 'string') {
    entries.push({ label: 'Deck', value: String(payload.deckName ?? payload.deckId) })
  }
  if (props.action.kind === 'set_deck_format') {
    entries.push({ label: 'Bisheriges Format', value: typeof payload.previousFormatName === 'string' ? payload.previousFormatName : 'Kein Format' })
    entries.push({ label: 'Neues Format', value: typeof payload.formatName === 'string' ? payload.formatName : 'Kein Format' })
  }
  else if (typeof payload.formatName === 'string' || typeof payload.formatId === 'string') {
    entries.push({ label: 'Format', value: String(payload.formatName ?? payload.formatId) })
  }
  return entries
})

const hasDetails = computed(() => rows.value.length > 0 || metaEntries.value.length > 0)

async function apply() {
  if (isApplying.value || isRejecting.value) {
    return
  }
  isApplying.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ action: AssistantActionView }>(
      `/api/assistant/chat/actions/${props.action.id}/apply`,
      { method: 'POST' },
    )
    emit('updated', response.action)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Der Vorschlag konnte nicht übernommen werden.')
  }
  finally {
    isApplying.value = false
  }
}

async function reject() {
  if (isApplying.value || isRejecting.value) {
    return
  }
  isRejecting.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ action: AssistantActionView }>(
      `/api/assistant/chat/actions/${props.action.id}/reject`,
      { method: 'POST' },
    )
    emit('updated', response.action)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Der Vorschlag konnte nicht verworfen werden.')
  }
  finally {
    isRejecting.value = false
  }
}
</script>

<template>
  <div class="flex justify-start">
    <div class="w-full max-w-md rounded-md border border-gray-200 bg-white p-3 text-sm">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-gray-900">{{ ASSISTANT_ACTION_KIND_LABELS[action.kind] }}</span>
        <UBadge
          :color="statusColor"
          variant="subtle"
          :label="ASSISTANT_ACTION_STATUS_LABELS[action.status]"
        />
      </div>

      <p class="mt-1 text-gray-600">
        {{ action.summary }}
      </p>

      <div
        v-if="preview"
        class="mt-2 space-y-2 rounded-md bg-gray-50 p-2 text-xs"
        data-testid="action-preview"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="legalityBadge.color"
            variant="subtle"
            size="sm"
            :label="legalityBadge.label"
          />
          <span class="text-gray-600">
            Main {{ preview.counts.main }} · Extra {{ preview.counts.extra }} · Side {{ preview.counts.side }}
          </span>
        </div>

        <ul
          v-if="preview.validation && preview.validation.issues.length > 0"
          class="list-inside list-disc space-y-0.5 text-red-700"
        >
          <li
            v-for="(issue, index) in preview.validation.issues.slice(0, PREVIEW_ISSUES_SHOWN)"
            :key="index"
          >
            {{ issue }}
          </li>
          <li
            v-if="preview.validation.issues.length > PREVIEW_ISSUES_SHOWN"
            class="list-none text-gray-500"
          >
            … und {{ preview.validation.issues.length - PREVIEW_ISSUES_SHOWN }} weitere
          </li>
        </ul>

        <div v-if="preview.missing.length > 0">
          <p class="font-medium text-amber-900">
            Fehlende Karten (nicht oder nicht genug im Inventar)
          </p>
          <ul class="mt-0.5 space-y-0.5 text-amber-800">
            <li
              v-for="card in preview.missing"
              :key="card.catalogCardId"
            >
              {{ card.name }}: {{ card.needed }} benötigt, {{ card.owned }} im Besitz
            </li>
          </ul>
        </div>

        <p class="text-gray-400">
          Stand beim Vorschlag
        </p>
      </div>

      <UButton
        v-if="hasDetails"
        color="neutral"
        variant="link"
        size="xs"
        class="tap-target mt-1 px-0"
        :label="isExpanded ? 'Details ausblenden' : 'Details anzeigen'"
        :trailing-icon="isExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="() => { isExpanded = !isExpanded }"
      />

      <div
        v-if="isExpanded"
        class="mt-2 space-y-2"
      >
        <dl
          v-if="metaEntries.length > 0"
          class="space-y-0.5 text-xs text-gray-500"
        >
          <div
            v-for="entry in metaEntries"
            :key="entry.label"
            class="flex gap-1"
          >
            <dt class="font-medium">
              {{ entry.label }}:
            </dt>
            <dd>{{ entry.value }}</dd>
          </div>
        </dl>

        <div
          v-if="rows.length > 0"
          class="overflow-x-auto"
        >
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-gray-400">
                <th
                  v-for="column in columns"
                  :key="column"
                  class="pr-3 pb-1 font-medium"
                >
                  {{ columnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in rows"
                :key="rowIndex"
                class="border-t border-gray-100"
              >
                <td
                  v-for="column in columns"
                  :key="column"
                  class="py-1 pr-3"
                >
                  {{ displayValue(column, row[column]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p
        v-if="errorMessage"
        class="mt-2 text-xs text-red-600"
      >
        {{ errorMessage }}
      </p>

      <div
        v-if="action.status === 'pending'"
        class="mt-3 flex gap-2"
      >
        <UButton
          size="xs"
          icon="i-lucide-check"
          label="Übernehmen"
          :loading="isApplying"
          :disabled="isRejecting"
          class="tap-target"
          @click="apply"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-x"
          label="Verwerfen"
          :loading="isRejecting"
          :disabled="isApplying"
          class="tap-target"
          @click="reject"
        />
      </div>

      <UButton
        v-if="openDeckId"
        :to="`/decks/${openDeckId}`"
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-lucide-layers"
        label="Deck öffnen"
        class="tap-target mt-3"
      />
    </div>
  </div>
</template>
