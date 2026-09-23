<script setup lang="ts">
useHead({ title: 'Neues Format – yugioh alpha' })

const toast = useToast()

async function onSaved(format: { id: string, name: string }) {
  toast.add({ title: `"${format.name}" gespeichert`, color: 'success' })
  await navigateTo('/formats')
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        to="/formats"
        label="Zurück zu den Formaten"
      />
      <LayoutPageHeader
        title="Neues Format"
        description="Lege Deckgrößen, Kopienlimits und eigene Regeln fest."
      />
    </div>

    <FormatsRuleFormatEditor @saved="onSaved" />
  </div>
</template>
