<script setup lang="ts">
/**
 * Page title row: one `<h1>`, an optional one-line description and the page
 * actions on the right (below the title on phones).
 *
 * Convention: list pages put their item count in `description` (use
 * `pluralize`), other pages a one-sentence explanation.
 *
 * The title is set in the display face (ADR 0016); `hyphens-auto` lets long
 * German words break at a syllable instead of overflowing on phones.
 *
 * Deliberately not Nuxt UI's `UPageHeader`, which adds a bottom border,
 * vertical padding and a much larger title.
 */
withDefaults(defineProps<{
  title?: string
  description?: string
  /** Small label above the title (e.g. the section a detail page belongs to). */
  eyebrow?: string
  /** Single-line title with ellipsis — for user-provided names. */
  truncate?: boolean
  /** Keep the `<h1>` for screen readers only (something else shows it). */
  hideTitle?: boolean
}>(), {
  title: undefined,
  description: undefined,
  eyebrow: undefined,
  truncate: false,
  hideTitle: false,
})
</script>

<template>
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <!-- `flex-1`, so content in the default slot (e.g. a toolbar) can span
         the full width; the actions box stays pinned right. -->
    <div class="min-w-0 flex-1">
      <p
        v-if="eyebrow"
        class="eyebrow mb-1.5"
      >
        {{ eyebrow }}
      </p>
      <h1
        :class="hideTitle
          ? 'sr-only'
          : ['font-display text-[1.625rem] leading-tight font-semibold tracking-[0.01em] text-highlighted sm:text-3xl', truncate ? 'truncate' : 'break-words hyphens-auto']"
      >
        <slot name="title">
          {{ title }}
        </slot>
      </h1>
      <p
        v-if="description || $slots.description"
        class="mt-1.5 text-sm text-muted"
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
