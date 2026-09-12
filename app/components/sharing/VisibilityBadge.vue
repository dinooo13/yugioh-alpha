<script setup lang="ts">
import { VISIBILITY_LABELS } from '~~/shared/sharing'
import type { Visibility } from '~~/shared/sharing'

const props = withDefaults(defineProps<{
  visibility: Visibility
  /** Hide the badge entirely for 'private' (the owner's default, everywhere else noise). */
  hidePrivate?: boolean
}>(), {
  hidePrivate: false,
})

const COLORS: Record<Visibility, 'neutral' | 'warning' | 'primary'> = {
  private: 'neutral',
  link: 'warning',
  public: 'primary',
}

const color = computed(() => COLORS[props.visibility])
const label = computed(() => VISIBILITY_LABELS[props.visibility])
const visible = computed(() => !(props.hidePrivate && props.visibility === 'private'))
</script>

<template>
  <UBadge
    v-if="visible"
    :color="color"
    variant="subtle"
    :label="label"
  />
</template>
