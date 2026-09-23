<script setup lang="ts">
/**
 * Page title row: one `<h1>`, an optional one-line description and the page
 * actions on the right (below the title on phones).
 *
 * Convention: list pages put their item count in `description` (use
 * `pluralize`), other pages a one-sentence explanation.
 *
 * Deliberately not Nuxt UI's `UPageHeader`, which adds a bottom border,
 * vertical padding and a much larger title.
 */
withDefaults(defineProps<{
  title?: string
  description?: string
  /** Single-line title with ellipsis — for user-provided names. */
  truncate?: boolean
}>(), {
  title: undefined,
  description: undefined,
  truncate: false,
})
</script>

<template>
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <!-- `flex-1`, so content in the default slot (e.g. a toolbar) can span
         the full width; the actions box stays pinned right. -->
    <div class="min-w-0 flex-1">
      <h1
        class="text-2xl font-semibold text-gray-900"
        :class="truncate ? 'truncate' : 'break-words'"
      >
        <slot name="title">
          {{ title }}
        </slot>
      </h1>
      <p
        v-if="description || $slots.description"
        class="mt-1 text-sm text-gray-500"
      >
        <slot name="description">
          {{ description }}
        </slot>
      </p>
      <slot />
    </div>

    <div
      v-if="$slots.actions"
      class="flex shrink-0 flex-wrap items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
