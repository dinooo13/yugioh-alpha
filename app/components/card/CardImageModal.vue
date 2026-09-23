<script setup lang="ts">
/**
 * Large view of a single card scan in a modal. Used by `CardThumb`'s
 * click-to-enlarge and as the base of the inventory card preview, which adds
 * its own details through the default slot.
 */
withDefaults(defineProps<{
  title: string
  description?: string
  src?: string | null
  noImageLabel?: string
}>(), {
  description: undefined,
  src: null,
  noImageLabel: 'Kein Bild',
})

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
  >
    <template #body>
      <div class="space-y-4">
        <img
          v-if="src"
          :src="src"
          :alt="title"
          decoding="async"
          class="mx-auto aspect-[59/86] max-h-[70vh] w-auto rounded-md object-contain"
        >
        <div
          v-else
          role="img"
          :aria-label="`${title}: ${noImageLabel}`"
          class="mx-auto flex aspect-[59/86] w-48 flex-col items-center justify-center gap-1 rounded-md bg-gray-100 text-xs text-gray-400"
        >
          <UIcon
            name="i-lucide-image-off"
            class="size-6"
            aria-hidden="true"
          />
          {{ noImageLabel }}
        </div>

        <slot />
      </div>
    </template>
  </UModal>
</template>
