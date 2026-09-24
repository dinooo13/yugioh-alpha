<script setup lang="ts">
/**
 * Empty/no-results state: icon circle, heading, explanation and optional
 * actions. `headingLevel` keeps the document outline intact when the state
 * sits below an existing `<h2>` section heading.
 *
 * Not Nuxt UI's `UEmpty`: that one always renders an `<h2>` title and brings
 * its own spacing and typography.
 */
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  headingLevel?: 2 | 3
  /** White card with a border; off when the state sits inside a card already. */
  bordered?: boolean
}>(), {
  description: undefined,
  icon: undefined,
  headingLevel: 2,
  bordered: true,
})
</script>

<template>
  <div
    class="flex flex-col items-center px-6 py-12 text-center"
    :class="{ 'rounded-md border border-default bg-default': bordered }"
  >
    <div
      v-if="icon"
      class="mb-4 flex size-12 items-center justify-center rounded-full bg-elevated text-muted"
    >
      <UIcon
        :name="icon"
        class="size-6"
        aria-hidden="true"
      />
    </div>
    <component
      :is="`h${headingLevel}`"
      class="text-base font-semibold text-highlighted"
    >
      {{ title }}
    </component>
    <p
      v-if="description || $slots.description"
      class="mt-1 max-w-sm text-sm text-muted"
    >
      <slot name="description">
        {{ description }}
      </slot>
    </p>
    <slot />
    <div
      v-if="$slots.actions"
      class="mt-4 flex flex-wrap items-center justify-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
