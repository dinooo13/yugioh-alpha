<script setup lang="ts">
import { createEntryRows } from '~/utils/card-entry'
import type { EntryRow, EntrySuggestResult } from '~/utils/card-entry'

interface CollectionOption {
  id: string
  name: string
}

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

useHead({ title: 'Schnellerfassung – yugioh alpha' })

const toast = useToast()

const mode = ref<'liste' | 'foto' | 'sprache'>('liste')
const rows = ref<EntryRow[]>([])
const isSuggesting = ref(false)
const errorMessage = ref('')

const { data: collectionsData } = await useFetch<{ items: CollectionOption[], allCount: number }>('/api/collections', {
  default: () => ({ items: [], allCount: 0 }),
})
const collections = computed(() => collectionsData.value?.items ?? [])

async function requestSuggestions(body: { text?: string, items?: string[], ocrText?: string }) {
  isSuggesting.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{ results: EntrySuggestResult[] }>('/api/inventory/entry/suggest', {
      method: 'POST',
      body,
    })
    rows.value = [...rows.value, ...createEntryRows(response.results)]
    return response.results.length
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Vorschläge konnten nicht geladen werden.'
    return 0
  }
  finally {
    isSuggesting.value = false
  }
}

// --- Liste -----------------------------------------------------------------

const listText = ref('')

async function submitList() {
  if (listText.value.trim() === '') {
    errorMessage.value = 'Bitte zuerst mindestens eine Karte eintragen.'
    return
  }

  const count = await requestSuggestions({ text: listText.value })
  if (count > 0) {
    listText.value = ''
  }
}

// --- Foto (OCR) ------------------------------------------------------------

const ocrProgress = ref(0)
const ocrStatus = ref('')
const isOcrRunning = ref(false)
const ocrText = ref('')
const isDragging = ref(false)

/**
 * Runs Tesseract in the browser (see docs/adr/0003): the image never leaves
 * the device and the server only ever sees the extracted text. The import is
 * dynamic and client-only so the ~2 MB worker never lands in the SSR bundle
 * or in any other page's chunk.
 */
async function runOcr(file: File) {
  if (!import.meta.client || isOcrRunning.value) {
    return
  }

  isOcrRunning.value = true
  errorMessage.value = ''
  ocrProgress.value = 0
  ocrStatus.value = 'Texterkennung wird vorbereitet...'

  try {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng', 1, {
      logger: (message: { status?: string, progress?: number }) => {
        if (message.status === 'recognizing text') {
          ocrProgress.value = Math.round((message.progress ?? 0) * 100)
          ocrStatus.value = 'Karte wird gelesen...'
        }
      },
    })

    try {
      const { data } = await worker.recognize(file)
      ocrText.value = data.text
      ocrStatus.value = 'Texterkennung abgeschlossen.'
      ocrProgress.value = 100
      const count = await requestSuggestions({ ocrText: data.text })
      if (count === 0 && errorMessage.value === '') {
        errorMessage.value = 'Im Bild wurde kein verwertbarer Kartenname gefunden.'
      }
    }
    finally {
      await worker.terminate()
    }
  }
  catch {
    ocrStatus.value = ''
    errorMessage.value = 'Die Texterkennung ist fehlgeschlagen. Versuche es mit einem schärferen Foto.'
  }
  finally {
    isOcrRunning.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    void runOcr(file)
  }
  input.value = ''
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    void runOcr(file)
  }
}

// --- Sprache ---------------------------------------------------------------

const speechSupported = ref(true)
const isListening = ref(false)
const speechLanguage = ref<'de-DE' | 'en-US'>('de-DE')
const transcript = ref('')
let recognition: SpeechRecognitionLike | null = null

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (!import.meta.client) {
    return undefined
  }
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

onMounted(() => {
  speechSupported.value = Boolean(speechRecognitionCtor())
})

function stopListening() {
  recognition?.stop()
  isListening.value = false
}

function startListening() {
  const Ctor = speechRecognitionCtor()
  if (!Ctor) {
    speechSupported.value = false
    return
  }

  errorMessage.value = ''
  recognition = new Ctor()
  recognition.lang = speechLanguage.value
  recognition.continuous = true
  recognition.interimResults = false

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (result?.isFinal) {
        const line = result[0].transcript.trim()
        if (line !== '') {
          transcript.value = transcript.value === '' ? line : `${transcript.value}\n${line}`
        }
      }
    }
  }
  recognition.onerror = () => {
    errorMessage.value = 'Die Spracherkennung wurde abgebrochen. Prüfe die Mikrofon-Freigabe.'
    isListening.value = false
  }
  recognition.onend = () => {
    isListening.value = false
  }

  recognition.start()
  isListening.value = true
}

watch(speechLanguage, () => {
  if (isListening.value) {
    stopListening()
  }
})

onBeforeUnmount(() => {
  recognition?.stop()
  recognition = null
})

async function submitTranscript() {
  if (transcript.value.trim() === '') {
    errorMessage.value = 'Es wurde noch nichts erkannt.'
    return
  }

  const count = await requestSuggestions({ text: transcript.value })
  if (count > 0) {
    transcript.value = ''
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
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Schnellerfassung
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          Karten als Liste tippen, per Foto einlesen oder diktieren — und vor dem Speichern prüfen.
        </p>
      </div>

      <UButton
        to="/inventar"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        label="Zum Inventar"
      />
    </div>

    <UFieldGroup>
      <UButton
        label="Liste"
        icon="i-lucide-list"
        color="neutral"
        :variant="mode === 'liste' ? 'solid' : 'outline'"
        @click="() => { mode = 'liste' }"
      />
      <UButton
        label="Foto"
        icon="i-lucide-camera"
        color="neutral"
        :variant="mode === 'foto' ? 'solid' : 'outline'"
        @click="() => { mode = 'foto' }"
      />
      <UButton
        label="Sprache"
        icon="i-lucide-mic"
        color="neutral"
        :variant="mode === 'sprache' ? 'solid' : 'outline'"
        @click="() => { mode = 'sprache' }"
      />
    </UFieldGroup>

    <div class="rounded-md border border-gray-200 bg-white p-4">
      <!-- Liste -->
      <div
        v-if="mode === 'liste'"
        class="space-y-3"
      >
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

        <UButton
          icon="i-lucide-wand-sparkles"
          label="Vorschläge laden"
          :loading="isSuggesting"
          @click="submitList"
        />
      </div>

      <!-- Foto -->
      <div
        v-else-if="mode === 'foto'"
        class="space-y-3"
      >
        <div
          class="flex flex-col items-center rounded-md border-2 border-dashed px-6 py-10 text-center"
          :class="isDragging ? 'border-primary bg-primary/5' : 'border-gray-300'"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <UIcon
            name="i-lucide-camera"
            class="size-8 text-gray-400"
          />
          <p class="mt-3 text-sm text-gray-700">
            Foto der Karte aufnehmen oder hierher ziehen
          </p>
          <p class="mt-1 text-xs text-gray-500">
            Die Texterkennung läuft direkt im Browser — das Bild wird nicht hochgeladen.
          </p>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Kartenfoto auswählen"
            class="mt-4 text-sm"
            :disabled="isOcrRunning"
            @change="onFileChange"
          >
        </div>

        <div
          v-if="isOcrRunning || ocrStatus"
          class="space-y-2"
        >
          <p class="text-sm text-gray-600">
            {{ ocrStatus }}
          </p>
          <UProgress
            v-if="isOcrRunning"
            :model-value="ocrProgress"
          />
        </div>

        <UFormField
          v-if="ocrText"
          label="Erkannter Text"
        >
          <UTextarea
            v-model="ocrText"
            :rows="4"
            class="w-full"
            aria-label="Erkannter Text"
          />
        </UFormField>
        <UButton
          v-if="ocrText"
          color="neutral"
          variant="outline"
          icon="i-lucide-wand-sparkles"
          label="Erkannten Text erneut auswerten"
          :loading="isSuggesting"
          @click="() => { requestSuggestions({ ocrText }) }"
        />
      </div>

      <!-- Sprache -->
      <div
        v-else
        class="space-y-3"
      >
        <UAlert
          v-if="!speechSupported"
          color="warning"
          variant="subtle"
          title="Spracheingabe wird hier nicht unterstützt"
          description="Dieser Browser kennt die Web Speech API nicht. Nutze Chrome oder Safari — oder gib die Karten als Liste ein."
        />

        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <UFieldGroup>
              <UButton
                label="Deutsch"
                color="neutral"
                :variant="speechLanguage === 'de-DE' ? 'solid' : 'outline'"
                @click="() => { speechLanguage = 'de-DE' }"
              />
              <UButton
                label="Englisch"
                color="neutral"
                :variant="speechLanguage === 'en-US' ? 'solid' : 'outline'"
                @click="() => { speechLanguage = 'en-US' }"
              />
            </UFieldGroup>

            <UButton
              v-if="!isListening"
              icon="i-lucide-mic"
              label="Aufnahme starten"
              @click="startListening"
            />
            <UButton
              v-else
              icon="i-lucide-square"
              color="error"
              label="Aufnahme stoppen"
              @click="stopListening"
            />
            <span
              v-if="isListening"
              class="text-sm text-gray-600"
            >Ich höre zu — sag einen Kartennamen pro Karte.</span>
          </div>

          <UFormField
            label="Erkannte Karten"
            description="Eine Karte pro Zeile — vor dem Auswerten noch korrigierbar."
          >
            <UTextarea
              v-model="transcript"
              :rows="6"
              class="w-full"
              aria-label="Erkannte Karten"
            />
          </UFormField>

          <UButton
            icon="i-lucide-wand-sparkles"
            label="Vorschläge laden"
            :loading="isSuggesting"
            @click="submitTranscript"
          />
        </template>
      </div>
    </div>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      title="Das hat nicht geklappt"
      :description="errorMessage"
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
        @saved="onSaved"
      />
    </div>
    <p
      v-else-if="!isSuggesting"
      class="text-sm text-gray-500"
    >
      Noch nichts zu prüfen — lies zuerst Karten über Liste, Foto oder Sprache ein.
    </p>
  </div>
</template>
