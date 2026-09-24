<script setup lang="ts">
/**
 * Two concentric "arcane" rings (ADR 0016: an original motif) that slowly
 * turn in opposite directions — only without reduced motion. Purely
 * decorative; size and position come from the caller's classes.
 */
</script>

<template>
  <svg
    viewBox="0 0 400 400"
    fill="none"
    aria-hidden="true"
    focusable="false"
    class="pointer-events-none"
  >
    <g class="origin-center motion-safe:animate-[spin_90s_linear_infinite]">
      <circle
        cx="200"
        cy="200"
        r="196"
        class="stroke-secondary/30"
        stroke-width="1"
      />
      <circle
        cx="200"
        cy="200"
        r="182"
        class="stroke-secondary/35"
        stroke-width="1.5"
        stroke-dasharray="2 14"
      />
      <path
        d="M200 4 207 18 200 32 193 18Z M200 368 207 382 200 396 193 382Z M4 200 18 193 32 200 18 207Z M368 200 382 193 396 200 382 207Z"
        class="fill-secondary/40"
      />
    </g>
    <g class="origin-center motion-safe:animate-[spin_120s_linear_infinite_reverse]">
      <circle
        cx="200"
        cy="200"
        r="150"
        class="stroke-primary/30"
        stroke-width="1"
        stroke-dasharray="40 8 4 8"
      />
      <polygon
        points="200,50 350,200 200,350 50,200"
        class="stroke-primary/20"
        stroke-width="1"
      />
      <circle
        cx="200"
        cy="200"
        r="96"
        class="stroke-secondary/20"
        stroke-width="1"
      />
    </g>
  </svg>
</template>
