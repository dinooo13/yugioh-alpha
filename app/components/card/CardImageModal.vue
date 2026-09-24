<script setup lang="ts">
/**
 * Large view of a single card scan in a modal: `CardThumb`'s click-to-enlarge
 * (the public shared deck and inventory views use it). The floating card
 * tilts and gets the foil sheen (`CardFloatingImage`). The rich card overlay
 * with the card text, stats and actions is `CardDetailModal`.
 */
withDefaults(defineProps<{
  title: string
  description?: string
  src?: string | null
  noImageLabel?: string
}>(), {
  description: undefined,
  src: null,
  noImageLabel: undefined,
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
        <!-- As wide as a 70vh-tall card, so a tall scan never overflows the screen. -->
        <CardFloatingImage
          :src="src"
          :alt="title"
          :no-image-label="noImageLabel"
          class="mx-auto w-[min(100%,calc(70vh*59/86))]"
        />
        <slot />
      </div>
    </template>
  </UModal>
</template>
