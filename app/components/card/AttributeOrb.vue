<script setup lang="ts">
import { attributeKey } from '~~/shared/card-frame'

/**
 * A card's attribute in the card language (ADR 0015) with a small orb in
 * the attribute's color (ADR 0016). The orb is decorative; the attribute is
 * always written out.
 */
const props = withDefaults(defineProps<{
  attribute: string
  size?: 'xs' | 'sm'
}>(), {
  size: 'sm',
})

const { cardValue } = useCardText()
const key = computed(() => attributeKey(props.attribute))
</script>

<template>
  <span
    class="inline-flex min-w-0 items-center gap-1.5 font-medium tracking-wide text-toned"
    :class="size === 'xs' ? 'text-[0.6875rem]' : 'text-xs'"
    :data-attribute="key ?? undefined"
  >
    <span
      class="attribute-orb"
      aria-hidden="true"
    />
    <span class="truncate">{{ cardValue('attribute', attribute) }}</span>
  </span>
</template>
