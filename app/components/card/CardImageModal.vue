<script setup lang="ts">
/**
 * Large view of a single card scan in a modal. Used by `CardThumb`'s
 * click-to-enlarge and as the base of the inventory card preview, which adds
 * its own details through the default slot.
 */
const props = withDefaults(defineProps<{
  title: string
  description?: string
  src?: string | null
  noImageLabel?: string
}>(), {
  description: undefined,
  src: null,
  noImageLabel: undefined,
})

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })

const resolvedNoImageLabel = computed(() => props.noImageLabel ?? t('card.noImage'))

const { style: tiltStyle, onMove: onTiltMove, onLeave: onTiltLeave } = useCardTilt()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-if="src"
          class="mx-auto w-fit rounded-[4.5%/3.1%] shadow-glow-primary transition-transform duration-300 ease-out-expo will-change-transform"
          :style="tiltStyle"
          @pointermove="onTiltMove"
          @pointerleave="onTiltLeave"
        >
          <img
            :src="src"
            :alt="title"
            decoding="async"
            class="block aspect-[59/86] max-h-[70vh] w-auto rounded-[4.5%/3.1%] object-contain"
          >
        </div>
        <div
          v-else
          role="img"
          :aria-label="t('card.noImageFor', { name: title, label: resolvedNoImageLabel })"
          class="card-back mx-auto flex aspect-[59/86] w-48 flex-col items-center justify-center gap-1 rounded-[4.5%/3.1%] text-xs font-medium"
        >
          <UIcon
            name="i-lucide-image-off"
            class="size-6"
            aria-hidden="true"
          />
          {{ resolvedNoImageLabel }}
        </div>

        <slot />
      </div>
    </template>
  </UModal>
</template>
