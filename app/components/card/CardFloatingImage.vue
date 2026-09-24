<script setup lang="ts">
/**
 * A single card scan, floating (ADR 0016: motion is a reward): it tilts
 * towards the pointer (`useCardTilt`) and a foil sheen sweeps across it on
 * hover. Both only run for hovering pointers that don't ask for reduced
 * motion — elsewhere the card stays still.
 *
 * The width comes from the caller's class (e.g. `w-48 md:w-full`); the card
 * keeps its 59:86 ratio. Without a scan, or when it fails to load, it shows
 * the arcane card back with the frame stripe, like `CardThumb`.
 */
import type { CardFrame } from '~/utils/card-frame'

const props = withDefaults(defineProps<{
  alt: string
  src?: string | null
  noImageLabel?: string
  /** The card's frame (`cardFrame()`), for the placeholder's color stripe. */
  frame?: CardFrame | null
  pendulum?: boolean
}>(), {
  src: null,
  noImageLabel: undefined,
  frame: null,
  pendulum: false,
})

const { t } = useI18n()

const failed = ref(false)
watch(() => props.src, () => {
  failed.value = false
})

const showImage = computed(() => Boolean(props.src) && !failed.value)
const resolvedNoImageLabel = computed(() => props.noImageLabel ?? t('card.noImage'))

const { style: tiltStyle, onMove: onTiltMove, onLeave: onTiltLeave } = useCardTilt()
</script>

<template>
  <div
    class="group rounded-[4.5%/3.1%] shadow-glow-primary transition-transform duration-300 ease-out-expo will-change-transform"
    :style="tiltStyle"
    @pointermove="onTiltMove"
    @pointerleave="onTiltLeave"
  >
    <div
      v-if="showImage"
      class="foil relative overflow-hidden rounded-[4.5%/3.1%]"
    >
      <img
        :src="src ?? undefined"
        :alt="alt"
        decoding="async"
        class="block aspect-[59/86] h-auto w-full object-contain"
        @error="failed = true"
      >
    </div>
    <div
      v-else
      role="img"
      :aria-label="t('card.noImageFor', { name: alt, label: resolvedNoImageLabel })"
      :data-frame="frame ?? undefined"
      :data-pendulum="frame && pendulum ? '' : undefined"
      class="card-back flex aspect-[59/86] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-[4.5%/3.1%] px-2 text-center text-xs font-medium"
    >
      <span
        v-if="frame"
        class="frame-stripe absolute inset-x-0 top-0 h-[3.5%] min-h-0.5"
        aria-hidden="true"
      />
      <UIcon
        name="i-lucide-image-off"
        class="size-6 opacity-80"
        aria-hidden="true"
      />
      {{ resolvedNoImageLabel }}
    </div>
  </div>
</template>
