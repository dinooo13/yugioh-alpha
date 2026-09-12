<script setup lang="ts">
import {
  ASSISTANT_MESSAGE_IMAGES_MAX,
  ASSISTANT_MESSAGE_TEXT_MAX,
  ASSISTANT_MESSAGE_TOTAL_BYTES_MAX,
} from '~~/shared/assistant-chat'

// Dictation types/logic reused verbatim from app/pages/inventar/erfassen.vue
// (see docs/adr/0010: voice dictation moved into the chat composer).
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

const props = withDefaults(defineProps<{
  disabled?: boolean
  streaming?: boolean
  cancelling?: boolean
}>(), {
  disabled: false,
  streaming: false,
  cancelling: false,
})

const emit = defineEmits<{
  send: [payload: { text: string, images: string[] }]
  cancel: []
}>()

const text = ref('')
const images = ref<string[]>([])
const errorMessage = ref('')
const isProcessingImage = ref(false)
const cameraInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)

// A touch device (phone/tablet) gets a dedicated camera button *and* a
// gallery one — `capture` on the camera input opens the camera directly,
// which would otherwise make an already-taken photo unreachable (#11). A
// mouse/trackpad device has no camera to jump to in the first place, so
// both inputs would just open the same file picker — show only one there.
const isTouchDevice = ref(import.meta.client && navigator.maxTouchPoints > 0)

const totalImageBytes = computed(() => images.value.reduce((sum, image) => sum + image.length, 0))
const canSend = computed(() =>
  !props.disabled && !props.streaming && !isProcessingImage.value && (text.value.trim() !== '' || images.value.length > 0))

// --- Images: max 3, resized client-side to ≤1280px JPEG q0.85 -------------

interface ImageSource {
  width: number
  height: number
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void
  dispose: () => void
}

/** Decodes `file` via `createImageBitmap` (honoring EXIF orientation so a
 * phone photo isn't resized sideways), falling back to a plain `<img>` +
 * `URL.createObjectURL` when `createImageBitmap` isn't available at all. */
async function loadImageSource(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
      dispose: () => bitmap.close(),
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image decode failed'))
      image.src = objectUrl
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      dispose: () => URL.revokeObjectURL(objectUrl),
    }
  }
  catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function resizeImageToDataUrl(file: File): Promise<string> {
  const source = await loadImageSource(file)
  try {
    const maxEdge = 1280
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('canvas 2d context unavailable')
    }
    source.draw(context, width, height)

    return canvas.toDataURL('image/jpeg', 0.85)
  }
  finally {
    source.dispose()
  }
}

async function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) {
    return
  }

  errorMessage.value = ''
  const free = ASSISTANT_MESSAGE_IMAGES_MAX - images.value.length
  if (free <= 0) {
    errorMessage.value = `Es sind höchstens ${ASSISTANT_MESSAGE_IMAGES_MAX} Bilder pro Nachricht erlaubt.`
    return
  }

  isProcessingImage.value = true
  try {
    for (const file of files.slice(0, free)) {
      const dataUrl = await resizeImageToDataUrl(file)
      if (totalImageBytes.value + dataUrl.length > ASSISTANT_MESSAGE_TOTAL_BYTES_MAX) {
        errorMessage.value = 'Die Bilder sind zusammen zu groß (max. 4 MB). Entferne eins oder nutze ein kleineres Foto.'
        break
      }
      images.value = [...images.value, dataUrl]
    }
  }
  catch {
    errorMessage.value = 'Das Bild konnte nicht verarbeitet werden.'
  }
  finally {
    isProcessingImage.value = false
  }
}

function removeImage(index: number) {
  images.value = images.value.filter((_, i) => i !== index)
}

// --- Send --------------------------------------------------------------------

function onSend() {
  if (!canSend.value) {
    return
  }
  const trimmed = text.value.trim()
  if (trimmed.length > ASSISTANT_MESSAGE_TEXT_MAX) {
    errorMessage.value = `Bitte höchstens ${ASSISTANT_MESSAGE_TEXT_MAX} Zeichen schreiben.`
    return
  }

  emit('send', { text: trimmed, images: images.value })
  text.value = ''
  images.value = []
  errorMessage.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSend()
  }
}

// --- Dictation (reused from app/pages/inventar/erfassen.vue) --------------

const speechSupported = ref(false)
const isListening = ref(false)
const speechLanguage = ref<'de-DE' | 'en-US'>('de-DE')
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

function teardownRecognition() {
  if (recognition) {
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition = null
  }
  isListening.value = false
}

function stopListening() {
  recognition?.stop()
  teardownRecognition()
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
          text.value = text.value === '' ? line : `${text.value}\n${line}`
        }
      }
    }
  }
  recognition.onerror = (event) => {
    // "no-speech" (a pause) and "aborted" (our own stop) are not failures.
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      errorMessage.value = 'Die Spracherkennung wurde abgebrochen. Prüfe die Mikrofon-Freigabe.'
    }
    teardownRecognition()
  }
  recognition.onend = () => {
    teardownRecognition()
  }

  recognition.start()
  isListening.value = true
}

function toggleListening() {
  if (isListening.value) {
    stopListening()
  }
  else {
    startListening()
  }
}

onBeforeUnmount(() => {
  recognition?.stop()
  teardownRecognition()
})
</script>

<template>
  <div class="border-t border-gray-200 p-3">
    <div
      v-if="images.length > 0"
      class="mb-2 flex flex-wrap gap-2"
    >
      <div
        v-for="(image, index) in images"
        :key="index"
        class="relative"
      >
        <img
          :src="image"
          alt=""
          class="size-16 rounded-md object-cover"
        >
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="solid"
          class="absolute -top-1.5 -right-1.5 rounded-full"
          :aria-label="`Bild ${index + 1} entfernen`"
          @click="removeImage(index)"
        />
      </div>
    </div>

    <p
      v-if="errorMessage"
      class="mb-2 text-xs text-red-600"
    >
      {{ errorMessage }}
    </p>

    <div class="flex items-end gap-2">
      <UTextarea
        v-model="text"
        :rows="2"
        autoresize
        class="w-full flex-1"
        placeholder="Nachricht an den Assistenten…"
        aria-label="Nachricht"
        :disabled="disabled || streaming"
        @keydown="onKeydown"
      />

      <input
        v-if="isTouchDevice"
        ref="cameraInput"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        class="hidden"
        aria-label="Foto aufnehmen"
        @change="onFilesSelected"
      >
      <UButton
        v-if="isTouchDevice"
        icon="i-lucide-camera"
        color="neutral"
        variant="outline"
        aria-label="Foto aufnehmen"
        :loading="isProcessingImage"
        :disabled="disabled || streaming || images.length >= ASSISTANT_MESSAGE_IMAGES_MAX"
        @click="cameraInput?.click()"
      />

      <input
        ref="galleryInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        :aria-label="isTouchDevice ? 'Aus Galerie hinzufügen' : 'Foto hinzufügen'"
        @change="onFilesSelected"
      >
      <UButton
        :icon="isTouchDevice ? 'i-lucide-images' : 'i-lucide-image'"
        color="neutral"
        variant="outline"
        :aria-label="isTouchDevice ? 'Aus Galerie hinzufügen' : 'Foto hinzufügen'"
        :loading="isProcessingImage"
        :disabled="disabled || streaming || images.length >= ASSISTANT_MESSAGE_IMAGES_MAX"
        @click="galleryInput?.click()"
      />

      <UButton
        v-if="speechSupported"
        :icon="isListening ? 'i-lucide-square' : 'i-lucide-mic'"
        :color="isListening ? 'error' : 'neutral'"
        variant="outline"
        :aria-label="isListening ? 'Aufnahme stoppen' : 'Aufnahme starten'"
        :disabled="disabled"
        @click="toggleListening"
      />

      <UButton
        v-if="!streaming"
        icon="i-lucide-send"
        label="Senden"
        :disabled="!canSend"
        @click="onSend"
      />
      <UButton
        v-else
        icon="i-lucide-square"
        color="neutral"
        variant="outline"
        :label="cancelling ? 'Wird abgebrochen…' : 'Abbrechen'"
        :disabled="cancelling"
        @click="emit('cancel')"
      />
    </div>

    <div
      v-if="speechSupported"
      class="mt-2 flex items-center gap-2"
    >
      <span class="text-xs text-gray-400">Sprache:</span>
      <UFieldGroup>
        <UButton
          label="Deutsch"
          size="xs"
          color="neutral"
          :variant="speechLanguage === 'de-DE' ? 'solid' : 'outline'"
          @click="() => { speechLanguage = 'de-DE' }"
        />
        <UButton
          label="Englisch"
          size="xs"
          color="neutral"
          :variant="speechLanguage === 'en-US' ? 'solid' : 'outline'"
          @click="() => { speechLanguage = 'en-US' }"
        />
      </UFieldGroup>
    </div>
  </div>
</template>
