<script setup lang="ts">
import {
  ASSISTANT_MESSAGE_IMAGES_MAX,
  ASSISTANT_MESSAGE_TEXT_MAX,
  ASSISTANT_MESSAGE_TOTAL_BYTES_MAX,
} from '~~/shared/assistant-chat'

const props = withDefaults(defineProps<{
  disabled?: boolean
  streaming?: boolean
  cancelling?: boolean
  /** Pre-fills the message field once, when the composer is created (e.g. a deck entry point's draft) — never sent on its own. */
  initialText?: string
}>(), {
  disabled: false,
  streaming: false,
  cancelling: false,
  initialText: '',
})

const emit = defineEmits<{
  send: [payload: { text: string, images: string[] }]
  cancel: []
}>()

const { t } = useI18n()

const text = ref(props.initialText)
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
const galleryLabel = computed(() => isTouchDevice.value ? t('assistant.composer.fromGallery') : t('assistant.composer.addPhoto'))

const totalImageBytes = computed(() => images.value.reduce((sum, image) => sum + image.length, 0))
const canSend = computed(() =>
  !props.disabled && !props.streaming && !isProcessingImage.value && (text.value.trim() !== '' || images.value.length > 0))

// --- Images: max 6, resized client-side to ≤1280px JPEG q0.85 -------------

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
    errorMessage.value = t('assistant.composer.errors.tooManyImages', { max: ASSISTANT_MESSAGE_IMAGES_MAX })
    return
  }

  isProcessingImage.value = true
  try {
    for (const file of files.slice(0, free)) {
      const dataUrl = await resizeImageToDataUrl(file)
      if (totalImageBytes.value + dataUrl.length > ASSISTANT_MESSAGE_TOTAL_BYTES_MAX) {
        errorMessage.value = t('assistant.composer.errors.imagesTooLarge', { max: ASSISTANT_MESSAGE_TOTAL_BYTES_MAX / (1024 * 1024) })
        break
      }
      images.value = [...images.value, dataUrl]
    }
  }
  catch {
    errorMessage.value = t('assistant.composer.errors.imageFailed')
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
    errorMessage.value = t('assistant.composer.errors.textTooLong', { max: ASSISTANT_MESSAGE_TEXT_MAX })
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
</script>

<template>
  <div class="border-t border-default p-3">
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
          :aria-label="t('assistant.composer.removeImage', { index: index + 1 })"
          @click="removeImage(index)"
        />
      </div>
    </div>

    <p
      v-if="errorMessage"
      class="mb-2 text-xs text-error"
    >
      {{ errorMessage }}
    </p>

    <div class="flex items-end gap-2">
      <UTextarea
        v-model="text"
        :rows="2"
        autoresize
        class="w-full flex-1"
        :placeholder="t('assistant.composer.placeholder')"
        :aria-label="t('assistant.composer.label')"
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
        :aria-label="t('assistant.composer.takePhoto')"
        @change="onFilesSelected"
      >
      <UButton
        v-if="isTouchDevice"
        icon="i-lucide-camera"
        color="neutral"
        variant="outline"
        :aria-label="t('assistant.composer.takePhoto')"
        :loading="isProcessingImage"
        :disabled="disabled || streaming || images.length >= ASSISTANT_MESSAGE_IMAGES_MAX"
        class="tap-target"
        @click="cameraInput?.click()"
      />

      <input
        ref="galleryInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        :aria-label="galleryLabel"
        @change="onFilesSelected"
      >
      <UButton
        :icon="isTouchDevice ? 'i-lucide-images' : 'i-lucide-image'"
        color="neutral"
        variant="outline"
        :aria-label="galleryLabel"
        :loading="isProcessingImage"
        :disabled="disabled || streaming || images.length >= ASSISTANT_MESSAGE_IMAGES_MAX"
        class="tap-target"
        @click="galleryInput?.click()"
      />

      <UButton
        v-if="!streaming"
        icon="i-lucide-send"
        :label="t('assistant.composer.send')"
        :disabled="!canSend"
        @click="onSend"
      />
      <UButton
        v-else
        icon="i-lucide-square"
        color="neutral"
        variant="outline"
        :label="cancelling ? t('assistant.composer.cancelling') : t('common.cancel')"
        :disabled="cancelling"
        @click="emit('cancel')"
      />
    </div>
  </div>
</template>
