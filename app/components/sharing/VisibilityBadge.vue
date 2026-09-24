<script setup lang="ts">
import type { Visibility } from '~~/shared/sharing'

const props = withDefaults(defineProps<{
  /** Null for a non-owner view (the API never discloses this owner-side setting to them). */
  visibility: Visibility | null
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

const { t } = useI18n()

const color = computed(() => (props.visibility ? COLORS[props.visibility] : 'neutral'))
const label = computed(() => (props.visibility ? t(`sharing.visibility.${props.visibility}.label`) : ''))
const visible = computed(() =>
  props.visibility != null && !(props.hidePrivate && props.visibility === 'private'))
</script>

<template>
  <UBadge
    v-if="visible"
    :color="color"
    variant="subtle"
    :label="label"
  />
</template>
