<script setup lang="ts">
import {
  MAX_ENTRY_LINES,
  MAX_ENTRY_ROWS,
  apiErrorMessage,
  createEntryRows,
} from '~/utils/card-entry'
import type { EntryRow, EntrySuggestResult } from '~/utils/card-entry'

interface CollectionOption {
  id: string
  name: string
}

useHead({ title: 'Schnellerfassung – yugioh alpha' })

const toast = useToast()
const route = useRoute()

const rows = ref<EntryRow[]>([])
const isSuggesting = ref(false)
const errorMessage = ref('')
const warningMessage = ref('')

// Deep-link from /inventar?collectionId=… so the Standardwerte panel starts
// on the collection the user was just looking at.
const presetCollectionId = computed(() => {
  const value = route.query.collectionId
  return typeof value === 'string' && value !== '' ? value : null
})

const { data: collectionsData } = await useFetch<{ items: CollectionOption[], allCount: number }>('/api/collections', {
  default: () => ({ items: [], allCount: 0 }),
})
const collections = computed(() => collectionsData.value?.items ?? [])

async function requestSuggestions(body: { text?: string, items?: string[] }) {
  isSuggesting.value = true
  errorMessage.value = ''
  warningMessage.value = ''

  try {
    const response = await $fetch<{ results: EntrySuggestResult[] }>('/api/inventory/entry/suggest', {
      method: 'POST',
      body,
    })

    const free = Math.max(0, MAX_ENTRY_ROWS - rows.value.length)
    const accepted = response.results.slice(0, free)
    if (accepted.length < response.results.length) {
      warningMessage.value = `Die Prüfliste fasst ${MAX_ENTRY_ROWS} Zeilen — `
        + `${response.results.length - accepted.length} Zeile(n) wurden nicht übernommen. `
        + 'Speichere zuerst die vorhandenen Zeilen.'
    }

    rows.value = [...rows.value, ...createEntryRows(accepted)]
    return accepted.length
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Vorschläge konnten nicht geladen werden.')
    return 0
  }
  finally {
    isSuggesting.value = false
  }
}

// --- Liste -----------------------------------------------------------------

const listText = ref('')

const listLineCount = computed(() => listText.value.split(/\r?\n/).filter(line => line.trim() !== '').length)
const tooManyLines = computed(() => listLineCount.value > MAX_ENTRY_LINES)

async function submitList() {
  if (listText.value.trim() === '') {
    errorMessage.value = 'Bitte zuerst mindestens eine Karte eintragen.'
    return
  }
  if (tooManyLines.value) {
    errorMessage.value = `Bitte höchstens ${MAX_ENTRY_LINES} Zeilen auf einmal auswerten.`
    return
  }

  const count = await requestSuggestions({ text: listText.value })
  if (count > 0) {
    listText.value = ''
  }
}

// --- Speichern -------------------------------------------------------------

function onSaved(result: { created: number, merged: number }) {
  toast.add({
    title: 'Karten gespeichert',
    description: `${result.created} neu · ${result.merged} zusammengeführt`,
    icon: 'i-lucide-check',
    color: 'success',
  })
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        :to="{ path: '/inventar', query: presetCollectionId ? { collectionId: presetCollectionId } : {} }"
        label="Zurück zum Inventar"
      />
      <LayoutPageHeader
        title="Schnellerfassung"
        description="Karten als Liste tippen — und vor dem Speichern prüfen."
      />
    </div>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-sparkles"
      title="Karten per Foto? Nutze den Assistenten"
      description="Ein Kartenfoto erkennen oder direkt ein Deck bauen lassen — das übernimmt jetzt der Assistent."
    >
      <template #actions>
        <UButton
          to="/assistent"
          size="xs"
          color="neutral"
          variant="outline"
          label="Zum Assistenten"
        />
      </template>
    </UAlert>

    <div class="rounded-md border border-gray-200 bg-white p-4">
      <div class="space-y-3">
        <UFormField
          label="Kartenliste"
          description="Eine Karte pro Zeile. Anzahl, Set-Code oder Passcode werden automatisch erkannt."
        >
          <UTextarea
            v-model="listText"
            :rows="8"
            class="w-full"
            aria-label="Kartenliste"
            placeholder="3x Dark Magician&#10;Pot of Greed&#10;Dark Magician (SDY-006)&#10;46986414"
          />
        </UFormField>

        <p class="text-xs text-gray-500">
          Beispiele: <span class="font-mono">3x Dark Magician</span>,
          <span class="font-mono">Dark Magician x3</span>,
          <span class="font-mono">Dark Magician (SDY-006)</span>,
          <span class="font-mono">SDY-006</span>,
          <span class="font-mono">46986414</span>
        </p>

        <p
          v-if="tooManyLines"
          class="text-xs text-amber-700"
        >
          {{ listLineCount }} Zeilen — bitte höchstens {{ MAX_ENTRY_LINES }} auf einmal auswerten.
        </p>

        <UButton
          icon="i-lucide-wand-sparkles"
          label="Vorschläge laden"
          :loading="isSuggesting"
          :disabled="tooManyLines"
          @click="submitList"
        />
      </div>
    </div>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      title="Das hat nicht geklappt"
      :description="errorMessage"
    />

    <UAlert
      v-if="warningMessage"
      color="warning"
      variant="subtle"
      title="Prüfliste ist voll"
      :description="warningMessage"
    />

    <div
      v-if="rows.length > 0"
      class="space-y-4"
    >
      <h2 class="text-lg font-semibold text-gray-900">
        Prüfen und korrigieren
      </h2>
      <EntryReviewTable
        v-model:rows="rows"
        :collections="collections"
        :preset-collection-id="presetCollectionId"
        @saved="onSaved"
      />
    </div>
    <p
      v-else-if="!isSuggesting"
      class="text-sm text-gray-500"
    >
      Noch nichts zu prüfen — lies zuerst Karten als Liste ein.
    </p>
  </div>
</template>
