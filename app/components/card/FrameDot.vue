<script setup lang="ts">
import { cardFrame } from '~~/shared/card-frame'

/**
 * A dot in the card's frame color (ADR 0016), for the start of a card's
 * type line. Decorative: the type is written next to it.
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
    class="frame-dot"
    :data-frame="frame.frame"
    :data-pendulum="frame.pendulum ? '' : undefined"
    aria-hidden="true"
  />
</template>
