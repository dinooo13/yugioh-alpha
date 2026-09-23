<script setup lang="ts">
/**
 * A profile's initials on a per-handle color (#29). Decorative: the name is
 * always rendered as text next to it, so the avatar is hidden from
 * assistive technology.
 */
import type { AvatarProps } from '@nuxt/ui'
import { avatarColorClasses, avatarInitials } from '~/utils/avatar'

const props = withDefaults(defineProps<{
  name: string
  /** Seed for the color; the handle keeps it stable across renames. */
  handle: string
  size?: AvatarProps['size']
}>(), {
  size: 'md',
})

const initials = computed(() => avatarInitials(props.name))
const color = computed(() => avatarColorClasses(props.handle))
</script>

<template>
  <UAvatar
    :text="initials"
    :size="size"
    aria-hidden="true"
    :ui="{ root: color.bg, fallback: `${color.text} font-semibold` }"
  />
</template>
