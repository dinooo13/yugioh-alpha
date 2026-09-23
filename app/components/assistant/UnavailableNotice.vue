<script setup lang="ts">
// Shown wherever the chat assistant would be when the server has no model
// provider configured. Deliberately says nothing about *how* to configure
// it (no env var names) — that's operator knowledge, not something a user
// of the app can act on.
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    title="Assistent nicht verfügbar"
    description="Der KI-Assistent ist auf diesem Server gerade nicht eingerichtet. Wende dich an die Person, die die App betreibt."
  />
</template>
