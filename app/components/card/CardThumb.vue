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
 * The visible strings default to the interface language (`card.noImage`,
 * `card.enlarge`); callers may override them.
 *
 * Duel Arena (ADR 0016): real card corners, a hairline edge so scans don't
 * bleed into a dark page, and an original "arcane card back" as the
 * placeholder — with a stripe in the card's `frame` color when known. `foil`
 * adds a sheen that sweeps across on hover of the surrounding `.group`.
 */
import type { CardFrame } from '~/utils/card-frame'

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
  /** The card's frame (`cardFrame()`), for the placeholder's color stripe. */
  frame?: CardFrame | null
  pendulum?: boolean
  foil?: boolean
}>(), {
  src: null,
  srcLarge: null,
  size: 'sm',
  sizes: undefined,
  enlargeable: false,
  enlargeLabel: undefined,
  noImageLabel: undefined,
  loading: 'lazy',
  frame: null,
  pendulum: false,
  foil: false,
})

const { t } = useI18n()

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
const resolvedEnlargeLabel = computed(() => props.enlargeLabel ?? t('card.enlarge', { name: props.alt }))
const resolvedNoImageLabel = computed(() => props.noImageLabel ?? t('card.noImage'))

// The width lives on an outer box and the 59:86 ratio on the inner frame: a
// flex row stretches its items vertically, which would override
// `aspect-ratio` on the item itself and distort the card.
const rootClasses = computed(() => [WIDTH_CLASSES[props.size], !isFull.value && 'shrink-0'])

const frameClasses = computed(() => [
  'relative block aspect-[59/86] w-full overflow-hidden rounded-[4.5%/3.1%] bg-elevated ring-1 ring-default',
  isFull.value && 'shadow-sm',
  props.foil && showImage.value && 'foil',
  canEnlarge.value && 'cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
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
        :aria-label="t('card.noImageFor', { name: alt, label: resolvedNoImageLabel })"
        :data-frame="frame ?? undefined"
        :data-pendulum="frame && pendulum ? '' : undefined"
        class="card-back flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-xs"
      >
        <span
          v-if="frame"
          class="frame-stripe absolute inset-x-0 top-0 h-[3.5%] min-h-0.5"
          aria-hidden="true"
        />
        <UIcon
          name="i-lucide-image-off"
          :class="size === 'xs' ? 'size-3' : isFull ? 'size-6' : 'size-4'"
          class="opacity-80"
          aria-hidden="true"
        />
        <span
          v-if="size === 'lg' || isFull"
          class="font-medium"
        >{{ resolvedNoImageLabel }}</span>
      </div>
    </component>

    <CardImageModal
      v-if="everOpened"
      v-model:open="isOpen"
      :title="alt"
      :src="srcLarge ?? src"
      :no-image-label="resolvedNoImageLabel"
    />
  </div>
</template>
