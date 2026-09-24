<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * The app's mark (ADR 0016): an original tilted card with a gold edge and a
 * serif "Y" in negative space, next to the wordmark in the display face.
 * Renders a link when `to` is set. The SVG is decorative; the wordmark is
 * the accessible name.
 */
const props = withDefaults(defineProps<{
  to?: RouteLocationRaw
  size?: 'sm' | 'md' | 'lg'
  /** Below `sm`, show only the mark (the wordmark stays the accessible name). */
  collapse?: boolean
}>(), {
  to: undefined,
  size: 'md',
  collapse: false,
})

// Unique gradient ids: the mark is on the page more than once (mobile header
// and sidebar), and a `url(#id)` that resolves into a hidden copy paints
// nothing.
const id = useId()

const SIZES = {
  sm: { mark: 'h-7', text: 'text-[0.9375rem]' },
  md: { mark: 'h-8', text: 'text-[1.0625rem]' },
  lg: { mark: 'h-14', text: 'text-[1.75rem]' },
} as const

const size = computed(() => SIZES[props.size])
</script>

<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'span'"
    :to="to"
    class="group/brand inline-flex min-w-0 items-center gap-2.5 rounded-md"
  >
    <svg
      viewBox="-124 -164 248 328"
      class="w-auto shrink-0 drop-shadow-[0_2px_8px_rgb(109_93_246/0.35)] transition-transform duration-300 ease-summon motion-safe:group-hover/brand:-rotate-3"
      :class="size.mark"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          :id="`${id}-card`"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="#8b7cf8"
          />
          <stop
            offset=".55"
            stop-color="#5a3fee"
          />
          <stop
            offset="1"
            stop-color="#2a1a86"
          />
        </linearGradient>
      </defs>
      <g transform="rotate(-8)">
        <rect
          x="-103"
          y="-150"
          width="206"
          height="300"
          rx="16"
          :fill="`url(#${id}-card)`"
          stroke="#e8b52e"
          stroke-width="10"
        />
        <path
          d="M-78-84H-22V-78H-32L0-26 44-78H36V-84H70V-78H60L13-2V72H34V80H-34V72H-13V-2L-64-78H-78Z"
          fill="#0a0a1a"
        />
      </g>
    </svg>
    <span
      class="truncate font-display font-semibold leading-none tracking-[0.04em]"
      :class="[size.text, { 'max-sm:sr-only': collapse }]"
    ><span class="text-highlighted">yugioh</span> <span class="text-secondary">alpha</span></span>
  </component>
</template>
