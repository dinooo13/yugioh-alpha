<script setup lang="ts">
/**
 * The one way to render a card scan: a 59:86 box (the real card aspect) with
 * the whole card visible (`object-contain`), lazy + async decoding, and a
 * consistent "no image" placeholder — also used when the hotlinked image
 * fails to load.
 *
 * - Fixed sizes (`xs`–`lg`) prefer the small scan; `full` fills its container,
 *   prefers the large scan and offers the small one via `srcset` (pass
 *   `sizes` to match the rendered width).
 * - `enlargeable` turns the thumbnail into a button that opens the scan in a
 *   `CardImageModal`. Never use it inside another button or `role="button"`
 *   element (catalog picker rows, catalog grid tiles, inventory tiles) —
 *   nested interactive elements are invalid and swallow the click. Those
 *   callers wrap a plain thumbnail in their own button instead.
 *
 * Visible strings are props with German defaults until the app gets i18n.
 */
type CardThumbSize = 'xs' | 'sm' | 'md' | 'lg' | 'full'

const props = withDefaults(defineProps<{
  alt: string
  src?: string | null
  srcLarge?: string | null
  size?: CardThumbSize
  sizes?: string
  enlargeable?: boolean
  enlargeLabel?: string
  noImageLabel?: string
  loading?: 'lazy' | 'eager'
}>(), {
  src: null,
  srcLarge: null,
  size: 'sm',
  sizes: undefined,
  enlargeable: false,
  enlargeLabel: undefined,
  noImageLabel: 'Kein Bild',
  loading: 'lazy',
})

const WIDTH_CLASSES: Record<CardThumbSize, string> = {
  xs: 'w-8',
  sm: 'w-10',
  md: 'w-12',
  lg: 'w-16',
  full: 'w-full',
}

const isFull = computed(() => props.size === 'full')

const imageSrc = computed(() => (isFull.value
  ? props.srcLarge ?? props.src
  : props.src ?? props.srcLarge))

// Small (168px) and full (421px) scans of the same artwork — only worth it
// when the thumbnail scales with its container.
const imageSrcset = computed(() => (isFull.value && props.src && props.srcLarge
  ? `${props.src} 168w, ${props.srcLarge} 421w`
  : undefined))

const failed = ref(false)
watch(imageSrc, () => {
  failed.value = false
})

const showImage = computed(() => Boolean(imageSrc.value) && !failed.value)
const canEnlarge = computed(() => props.enlargeable && showImage.value)
const resolvedEnlargeLabel = computed(() => props.enlargeLabel ?? `${props.alt} vergrößern`)

// The width lives on an outer box and the 59:86 ratio on the inner frame: a
// flex row stretches its items vertically, which would override
// `aspect-ratio` on the item itself and distort the card.
const rootClasses = computed(() => [WIDTH_CLASSES[props.size], !isFull.value && 'shrink-0'])

const frameClasses = computed(() => [
  'block aspect-[59/86] w-full overflow-hidden bg-gray-100',
  isFull.value ? 'rounded-md' : 'rounded',
  canEnlarge.value && 'cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
])

// The modal is only mounted once someone actually asks for it, so long card
// lists don't carry one dialog instance per row.
const everOpened = ref(false)
const isOpen = ref(false)

function onClick() {
  if (!canEnlarge.value) {
    return
  }
  everOpened.value = true
  isOpen.value = true
}
</script>

<template>
  <div :class="rootClasses">
    <component
      :is="canEnlarge ? 'button' : 'div'"
      :type="canEnlarge ? 'button' : undefined"
      :aria-label="canEnlarge ? resolvedEnlargeLabel : undefined"
      :class="frameClasses"
      @click="onClick"
    >
      <img
        v-if="showImage"
        :src="imageSrc ?? undefined"
        :srcset="imageSrcset"
        :sizes="imageSrcset ? sizes : undefined"
        :alt="alt"
        :loading="loading"
        decoding="async"
        class="h-full w-full object-contain"
        @error="failed = true"
      >
      <div
        v-else
        role="img"
        :aria-label="`${alt}: ${noImageLabel}`"
        class="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-xs text-gray-400"
      >
        <UIcon
          name="i-lucide-image-off"
          :class="size === 'xs' ? 'size-3' : isFull ? 'size-6' : 'size-4'"
          aria-hidden="true"
        />
        <span v-if="size === 'lg' || isFull">{{ noImageLabel }}</span>
      </div>
    </component>

    <CardImageModal
      v-if="everOpened"
      v-model:open="isOpen"
      :title="alt"
      :src="srcLarge ?? src"
      :no-image-label="noImageLabel"
    />
  </div>
</template>
