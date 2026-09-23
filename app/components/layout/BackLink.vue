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
    class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 max-lg:min-h-11"
  >
    <UIcon
      name="i-lucide-arrow-left"
      class="size-4"
      aria-hidden="true"
    />
    {{ label }}
  </NuxtLink>
</template>
