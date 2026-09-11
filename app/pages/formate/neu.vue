<script setup lang="ts">
useHead({ title: 'Neues Format – yugioh alpha' })

const toast = useToast()

async function onSaved(format: { id: string, name: string }) {
  toast.add({ title: `"${format.name}" gespeichert`, color: 'success' })
  await navigateTo('/formate')
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <NuxtLink
        to="/formate"
        class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        Zurück zu den Formaten
      </NuxtLink>
      <h1 class="mt-2 text-2xl font-semibold text-gray-900">
        Neues Format
      </h1>
    </div>

    <FormatsRuleFormatEditor @saved="onSaved" />
  </div>
</template>
