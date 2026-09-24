<script setup lang="ts">
/**
 * Light/dark switch (ADR 0016). Not Nuxt UI's `UColorModeButton`: that one
 * picks its icon with `dark:` classes, which always show the moon inside the
 * always-dark sidebar, and its label depends on a value the server doesn't
 * know. The label names the action; the icon shows the current mode.
 */
withDefaults(defineProps<{
  size?: 'xs' | 'sm' | 'md'
}>(), {
  size: 'md',
})

const { t } = useI18n()
const { isDark, toggle } = useIsDark()
</script>

<template>
  <UButton
    :icon="isDark ? 'i-lucide-moon-star' : 'i-lucide-sun'"
    :aria-label="isDark ? t('app.colorMode.switchToLight') : t('app.colorMode.switchToDark')"
    :title="isDark ? t('app.colorMode.switchToLight') : t('app.colorMode.switchToDark')"
    :size="size"
    color="neutral"
    variant="ghost"
    class="tap-target"
    data-testid="color-mode-toggle"
    @click="toggle"
  />
</template>
