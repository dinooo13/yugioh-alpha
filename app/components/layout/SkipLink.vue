<script setup lang="ts">
/**
 * "Skip to content" (`app.skipLink`) — the first focusable element of a layout, visible
 * only while focused. The plain `href` works without JavaScript; with it,
 * focus moves to the target directly instead of going through the router
 * (a hash navigation would change `route.fullPath`, which the default layout
 * watches to close the mobile drawer).
 */
const props = withDefaults(defineProps<{
  label?: string
  target?: string
}>(), {
  label: undefined,
  target: 'main-content',
})

const { t } = useI18n()

function onClick() {
  const element = document.getElementById(props.target)
  if (!element) {
    return
  }
  element.focus()
  element.scrollIntoView()
}
</script>

<template>
  <a
    :href="`#${target}`"
    class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-default focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-highlighted focus:shadow-lift focus:ring-1 focus:ring-default focus:outline-2 focus:outline-offset-2 focus:outline-focus"
    @click.prevent="onClick"
  >
    {{ label ?? t('app.skipLink') }}
  </a>
</template>
