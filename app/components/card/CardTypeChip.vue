<script setup lang="ts">
import { cardFrame } from '~/utils/card-frame'

/**
 * The card type in the card language (ADR 0015), with a dot in the card's
 * frame color in front (ADR 0016). The dot is decorative; the type is
 * always written out.
 */
const props = withDefaults(defineProps<{
  type: string
  frameType?: string | null
  size?: 'xs' | 'sm'
}>(), {
  frameType: null,
  size: 'sm',
})

const { cardValue } = useCardText()
const frame = computed(() => cardFrame(props))
</script>

<template>
  <span
    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-elevated/60 text-default ring-1 ring-default ring-inset"
    :class="size === 'xs' ? 'px-1.5 py-px text-[0.6875rem]' : 'px-2 py-0.5 text-xs'"
    :data-frame="frame?.frame"
    :data-pendulum="frame?.pendulum ? '' : undefined"
  >
    <span
      v-if="frame"
      class="frame-dot"
      aria-hidden="true"
    />
    <span class="truncate">{{ cardValue('type', type) }}</span>
  </span>
</template>
