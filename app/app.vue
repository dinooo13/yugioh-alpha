<script setup lang="ts">
import { de, en } from '@nuxt/ui/locale'
import { DEFAULT_APP_LOCALE, isAppLocale } from '~~/shared/locale'
import type { AppLocale } from '~~/shared/locale'

// Nuxt UI's own strings (select placeholders, close buttons, …) and
// <html lang> follow the interface language (ADR 0014).
const uiLocales = { de, en } satisfies Record<AppLocale, unknown>
const { locale } = useI18n()
const appLocale = computed<AppLocale>(() => isAppLocale(locale.value) ? locale.value : DEFAULT_APP_LOCALE)

// Color mode (ADR 0016): dark unless the `ygo-color-mode` cookie says light.
// @nuxtjs/color-mode only sets the `<html>` class from its inline script, so
// the server renders it (and `theme-color`) from the cookie itself; on the
// client both follow the toggle.
const { isDark } = useIsDark()

useHead({
  htmlAttrs: {
    lang: appLocale,
    class: computed(() => isDark.value ? 'dark' : 'light'),
  },
  meta: [
    { name: 'theme-color', content: computed(() => isDark.value ? '#0a0a1a' : '#f3f2f8') },
    { name: 'color-scheme', content: computed(() => isDark.value ? 'dark' : 'light') },
  ],
})
</script>

<template>
  <UApp :locale="uiLocales[appLocale]">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
