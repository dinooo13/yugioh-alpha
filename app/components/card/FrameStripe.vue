<script setup lang="ts">
import { cardFrame } from '~/utils/card-frame'

/**
 * A 3px stripe in the card's frame color on the start edge of a card row
 * (ADR 0016). Put it inside a `relative` row; decorative only.
 */
const props = withDefaults(defineProps<{
  type?: string | null
  frameType?: string | null
}>(), {
  type: null,
  frameType: null,
})

const frame = computed(() => cardFrame(props))
</script>

<template>
  <span
    v-if="frame"
    class="frame-stripe-y absolute inset-y-2 left-0 w-[3px] rounded-e-full"
    :data-frame="frame.frame"
    :data-pendulum="frame.pendulum ? '' : undefined"
    aria-hidden="true"
  />
</template>
