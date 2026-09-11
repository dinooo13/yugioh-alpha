<script setup lang="ts">
import {
  ENTRY_CONDITION_ITEMS,
  ENTRY_EDITION_ITEMS,
  ENTRY_LANGUAGE_ITEMS,
  NO_COLLECTION_VALUE,
  buildBulkItems,
  isEntryRowResolved,
  summarizeEntryRows,
} from '~/utils/card-entry'
import type { EntryDefaults, EntryRow } from '~/utils/card-entry'

interface CollectionOption {
  id: string
  name: string
}

interface BulkResponse {
  created: number
  merged: number
}

const props = defineProps<{
  collections?: CollectionOption[]
}>()

const emit = defineEmits<{
  saved: [result: BulkResponse]
}>()

const rows = defineModel<EntryRow[]>('rows', { required: true })

const defaults = reactive<EntryDefaults>({
  language: 'en',
  condition: 'near_mint',
  edition: 'unlimited',
  collectionId: NO_COLLECTION_VALUE,
})

const collections = computed(() => props.collections ?? [])
const collectionItems = computed(() => [
  { label: '— (keine)', value: NO_COLLECTION_VALUE },
  ...collections.value.map(collection => ({ label: collection.name, value: collection.id })),
])

const summary = computed(() => summarizeEntryRows(rows.value))
const resolvedCount = computed(() => rows.value.filter(isEntryRowResolved).length)
const hasUnresolved = computed(() => summary.value.unsicher + summary.value.ohneTreffer > 0)
const canSaveAll = computed(() => rows.value.length > 0 && !hasUnresolved.value)

const isSaving = ref(false)
const errorMessage = ref('')
const itemErrors = ref<string[]>([])

function updateRow(id: string, patch: Partial<EntryRow>) {
  rows.value = rows.value.map(row => row.id === id ? { ...row, ...patch } : row)
}

function removeRow(id: string) {
  rows.value = rows.value.filter(row => row.id !== id)
}

function clearAll() {
  rows.value = []
  errorMessage.value = ''
  itemErrors.value = []
}

async function save(keepUnresolved: boolean) {
  const items = buildBulkItems(rows.value, defaults)
  if (items.length === 0) {
    errorMessage.value = 'Es gibt keine aufgelösten Zeilen zum Speichern.'
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  itemErrors.value = []

  try {
    const response = await $fetch<BulkResponse>('/api/inventory/bulk', {
      method: 'POST',
      body: { items },
    })

    // Saved rows disappear; unresolved ones stay so the user can finish them.
    rows.value = keepUnresolved ? rows.value.filter(row => !isEntryRowResolved(row)) : []
    emit('saved', response)
  }
  catch (error) {
    const data = (error as { data?: { data?: { errors?: Array<{ index: number, message: string }> } } }).data
    const errors = data?.data?.errors
    if (errors?.length) {
      itemErrors.value = errors.map(entry => `Zeile ${entry.index + 1}: ${entry.message}`)
    }
    errorMessage.value = error instanceof Error ? error.message : 'Die Karten konnten nicht gespeichert werden.'
  }
  finally {
    isSaving.value = false
  }
}

defineExpose({ defaults, summary, canSaveAll })
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-md border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-semibold text-gray-900">
        Standardwerte
      </h2>
      <p class="mt-1 text-xs text-gray-500">
        Gelten für alle Zeilen, solange eine Zeile nichts anderes vorgibt.
      </p>
      <div class="mt-3 grid gap-3 sm:grid-cols-4">
        <UFormField label="Sprache">
          <USelect
            v-model="defaults.language"
            :items="ENTRY_LANGUAGE_ITEMS"
            aria-label="Standard-Sprache"
          />
        </UFormField>
        <UFormField label="Zustand">
          <USelect
            v-model="defaults.condition"
            :items="ENTRY_CONDITION_ITEMS"
            aria-label="Standard-Zustand"
          />
        </UFormField>
        <UFormField label="Edition">
          <USelect
            v-model="defaults.edition"
            :items="ENTRY_EDITION_ITEMS"
            aria-label="Standard-Edition"
          />
        </UFormField>
        <UFormField label="Sammlung">
          <USelect
            v-model="defaults.collectionId"
            :items="collectionItems"
            aria-label="Standard-Sammlung"
          />
        </UFormField>
      </div>
    </div>

    <div class="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge
          color="neutral"
          variant="subtle"
          :label="`${summary.total} gesamt`"
        />
        <UBadge
          color="success"
          variant="subtle"
          :label="`${summary.sicher} sicher`"
        />
        <UBadge
          color="warning"
          variant="subtle"
          :label="`${summary.unsicher} unsicher`"
        />
        <UBadge
          color="error"
          variant="subtle"
          :label="`${summary.ohneTreffer} ohne Treffer`"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Liste leeren"
          :disabled="rows.length === 0"
          @click="clearAll"
        />
        <UButton
          v-if="hasUnresolved"
          color="neutral"
          variant="outline"
          label="Nur aufgelöste speichern"
          :loading="isSaving"
          :disabled="resolvedCount === 0"
          @click="save(true)"
        />
        <UButton
          icon="i-lucide-save"
          label="Alle speichern"
          :loading="isSaving"
          :disabled="!canSaveAll"
          @click="save(false)"
        />
      </div>
    </div>

    <p
      v-if="hasUnresolved"
      class="text-xs text-amber-700"
    >
      Es gibt noch offene Zeilen. Wähle einen Treffer aus oder entferne die Zeile, um alle zu speichern.
    </p>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      title="Speichern fehlgeschlagen"
      :description="errorMessage"
    />
    <ul
      v-if="itemErrors.length > 0"
      class="list-inside list-disc text-sm text-red-600"
    >
      <li
        v-for="itemError in itemErrors"
        :key="itemError"
      >
        {{ itemError }}
      </li>
    </ul>

    <div class="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
      <EntryReviewRow
        v-for="row in rows"
        :key="row.id"
        :row="row"
        :defaults="defaults"
        :collections="collections"
        @update="patch => updateRow(row.id, patch)"
        @remove="removeRow(row.id)"
      />
    </div>
  </div>
</template>
