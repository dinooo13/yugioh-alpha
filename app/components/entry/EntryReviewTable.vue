<script setup lang="ts">
import {
  NO_COLLECTION_VALUE,
  apiItemErrors,
  buildBulkEntries,
  chunkBulkEntries,
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
  presetCollectionId?: string | null
}>()

const emit = defineEmits<{
  saved: [result: BulkResponse]
}>()

const rows = defineModel<EntryRow[]>('rows', { required: true })

const { t } = useI18n()
const apiError = useApiError()
const apiErrorCode = useApiErrorCode()
const { languageItems, conditionItems, editionItems } = useCardOptionItems()

const defaults = reactive<EntryDefaults>({
  language: 'en',
  condition: 'near_mint',
  edition: 'unlimited',
  collectionId: NO_COLLECTION_VALUE,
})

// Coming from /inventory?collectionId=… the user is working on that box, so
// preselect it instead of making them pick it again.
watch(
  () => props.presetCollectionId,
  (value) => {
    defaults.collectionId = value ?? NO_COLLECTION_VALUE
  },
  { immediate: true },
)

const collections = computed(() => props.collections ?? [])
const collectionItems = computed(() => [
  { label: t('inventory.noCollectionOption'), value: NO_COLLECTION_VALUE },
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

function rowLabel(rowId: string): string {
  const row = rows.value.find(entry => entry.id === rowId)
  return row ? row.raw : rowId
}

/**
 * Saves in server-sized batches, sequentially: every batch that succeeds is
 * removed from the queue, and the first failing batch stops the run and is
 * reported per row, so nothing is silently lost or written twice.
 */
async function save() {
  const entries = buildBulkEntries(rows.value, defaults)
  if (entries.length === 0) {
    errorMessage.value = t('quickEntry.review.nothingResolved')
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  itemErrors.value = []

  const savedRowIds = new Set<string>()
  let created = 0
  let merged = 0

  for (const chunk of chunkBulkEntries(entries)) {
    try {
      const response = await $fetch<BulkResponse>('/api/inventory/bulk', {
        method: 'POST',
        body: { items: chunk.map(entry => entry.item) },
      })

      created += response.created
      merged += response.merged
      for (const entry of chunk) {
        savedRowIds.add(entry.rowId)
      }
    }
    catch (error) {
      itemErrors.value = apiItemErrors(error).map((itemError) => {
        const failed = chunk[itemError.index]
        return t('quickEntry.review.itemError', {
          line: failed ? rowLabel(failed.rowId) : `#${itemError.index + 1}`,
          message: apiErrorCode(itemError.code, itemError.params, 'quickEntry.review.itemInvalid'),
        })
      })
      errorMessage.value = apiError(error, 'quickEntry.review.saveFailed')
      break
    }
  }

  // Saved rows disappear; unresolved (and failed) ones stay so the user can
  // finish them.
  rows.value = rows.value.filter(row => !savedRowIds.has(row.id))
  isSaving.value = false

  if (created + merged > 0) {
    emit('saved', { created, merged })
  }
}

defineExpose({ defaults, summary, canSaveAll })
</script>

<template>
  <div class="space-y-4">
    <div class="panel p-4">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('quickEntry.defaults.title') }}
      </h2>
      <p class="mt-1 text-xs text-muted">
        {{ t('quickEntry.defaults.description') }}
      </p>
      <div class="mt-3 grid gap-3 sm:grid-cols-4">
        <UFormField :label="t('card.field.printingLanguage')">
          <USelect
            v-model="defaults.language"
            :items="languageItems"
            :aria-label="t('quickEntry.defaults.printingLanguage')"
          />
        </UFormField>
        <UFormField :label="t('card.field.condition')">
          <USelect
            v-model="defaults.condition"
            :items="conditionItems"
            :aria-label="t('quickEntry.defaults.condition')"
          />
        </UFormField>
        <UFormField :label="t('quickEntry.field.edition')">
          <USelect
            v-model="defaults.edition"
            :items="editionItems"
            :aria-label="t('quickEntry.defaults.edition')"
          />
        </UFormField>
        <UFormField :label="t('card.field.collection')">
          <USelect
            v-model="defaults.collectionId"
            :items="collectionItems"
            :aria-label="t('quickEntry.defaults.collection')"
          />
        </UFormField>
      </div>
    </div>

    <div class="flex flex-col gap-3 panel p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge
          color="neutral"
          variant="subtle"
          :label="t('quickEntry.summary.total', { count: summary.total })"
        />
        <UBadge
          color="success"
          variant="subtle"
          :label="t('quickEntry.summary.sicher', { count: summary.sicher })"
        />
        <UBadge
          color="warning"
          variant="subtle"
          :label="t('quickEntry.summary.unsicher', { count: summary.unsicher })"
        />
        <UBadge
          color="error"
          variant="subtle"
          :label="t('quickEntry.summary.ohne_treffer', { count: summary.ohneTreffer })"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('quickEntry.review.clear')"
          :disabled="rows.length === 0"
          @click="clearAll"
        />
        <UButton
          v-if="hasUnresolved"
          color="neutral"
          variant="outline"
          :label="t('quickEntry.review.saveResolved')"
          :loading="isSaving"
          :disabled="resolvedCount === 0"
          @click="save"
        />
        <UButton
          icon="i-lucide-save"
          :label="t('quickEntry.review.saveAll')"
          :loading="isSaving"
          :disabled="!canSaveAll"
          @click="save"
        />
      </div>
    </div>

    <p
      v-if="hasUnresolved"
      class="text-xs text-warning"
    >
      {{ t('quickEntry.review.unresolvedHint') }}
    </p>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="t('quickEntry.review.saveFailedTitle')"
      :description="errorMessage"
    />
    <ul
      v-if="itemErrors.length > 0"
      class="list-inside list-disc text-sm text-error"
    >
      <li
        v-for="itemError in itemErrors"
        :key="itemError"
      >
        {{ itemError }}
      </li>
    </ul>

    <div class="divide-y divide-default panel overflow-hidden">
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
