<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * "Zurück zu …" link above a page header. The accessible name is exactly
 * `label` (the arrow is decorative); below `lg` it gets a 44px tall hit box.
 */
defineProps<{
  to: RouteLocationRaw
  label: string
}>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="group/back inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted transition-colors hover:text-highlighted max-lg:min-h-11"
  >
    <UIcon
      name="i-lucide-arrow-left"
      class="size-4 transition-transform duration-200 motion-safe:group-hover/back:-translate-x-0.5"
      aria-hidden="true"
    />
    {{ label }}
  </NuxtLink>
</template>
