<script setup lang="ts">
/**
 * Three fanned, face-down cards (the original arcane card back, ADR 0016)
 * for heroes and banners. They float gently when motion is welcome.
 * Decorative only.
 */
withDefaults(defineProps<{
  /** Width of one card, as a Tailwind width class. */
  cardClass?: string
  float?: boolean
}>(), {
  cardClass: 'w-24',
  float: true,
})

const CARDS = [
  { rotate: '-14deg', x: '-58%', delay: '0s' },
  { rotate: '9deg', x: '58%', delay: '-2s' },
  { rotate: '-2deg', x: '0%', delay: '-4s' },
] as const
</script>

<template>
  <div
    class="relative isolate flex items-end justify-center"
    aria-hidden="true"
  >
    <!-- The first two only take up room through the absolute positioning;
         the last (front) card sizes the box. -->
    <span
      v-for="(card, index) in CARDS"
      :key="index"
      class="card-back block aspect-[59/86] rounded-[4.5%/3.1%] shadow-lift ring-1 ring-secondary/30"
      :class="[cardClass, index < 2 ? 'absolute bottom-0' : 'relative', float && 'motion-safe:animate-[card-float_6s_ease-in-out_infinite]']"
      :style="{ '--r': card.rotate, '--x': card.x, 'transform': 'translateX(var(--x)) rotate(var(--r))', 'transformOrigin': '50% 100%', 'animationDelay': card.delay }"
    />
  </div>
</template>
