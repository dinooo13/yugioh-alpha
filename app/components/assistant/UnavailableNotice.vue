<script setup lang="ts">
// Shown wherever the chat assistant would be when the server has no model
// provider configured. Deliberately says nothing about *how* to configure
// it (no env var names) — that's operator knowledge, not something a user
// of the app can act on.
const { t } = useI18n()
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    :title="t('assistant.unavailable.title')"
    :description="t('assistant.unavailable.description')"
  />
</template>
