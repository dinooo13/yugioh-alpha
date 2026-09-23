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
  for (const row of rows.value) {
    for (const key of Object.keys(row)) {
      if (key in FIELD_LABELS && row[key] !== null && row[key] !== undefined && !keys.includes(key)) {
        keys.push(key)
      }
    }
  }
  return keys
})

function displayValue(column: string, value: unknown): string {
  if (column === 'section' && typeof value === 'string' && value in DECK_SECTION_LABELS) {
    return DECK_SECTION_LABELS[value as DeckSection]
  }
  return String(value)
}

// Top-level scalars worth showing above the row table (e.g. create_deck's
// name/formatId, update_deck_cards' deckId) — arrays are rendered as rows
// instead, everything else in the payload is internal detail.
const metaEntries = computed(() => {
  const entries: Array<{ label: string, value: string }> = []
  const payload = props.action.payload
  if (typeof payload.name === 'string') {
    entries.push({ label: 'Name', value: payload.name })
  }
  if (typeof payload.deckId === 'string') {
    entries.push({ label: 'Deck', value: payload.deckId })
  }
  if (typeof payload.formatId === 'string') {
    entries.push({ label: 'Format', value: payload.formatId })
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
                  {{ FIELD_LABELS[column] }}
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
    </div>
  </div>
</template>
