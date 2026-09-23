<script setup lang="ts">
import type { RuleSet } from '~~/shared/rule-formats'

interface RuleFormatDetail {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  rules: RuleSet
  cardNames: Record<string, string>
  createdAt: string
  updatedAt: string
}

const route = useRoute()
const toast = useToast()
const formatId = computed(() => String(route.params.id ?? ''))
const errorMessage = ref('')

const { data: format, error } = await useFetch<RuleFormatDetail>(() => `/api/formats/${formatId.value}`, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

useHead({ title: computed(() => `${format.value?.name ?? 'Format'} – yugioh alpha`) })

async function onSaved(saved: { id: string, name: string }) {
  toast.add({ title: `"${saved.name}" gespeichert`, color: 'success' })
  await navigateTo('/formate')
}

async function cloneFormat() {
  if (!format.value) {
    return
  }

  errorMessage.value = ''
  try {
    const copy = await $fetch<{ id: string, name: string }>(`/api/formats/${format.value.id}/clone`, { method: 'POST' })
    toast.add({ title: `"${copy.name}" erstellt`, color: 'success' })
    await navigateTo(`/formate/${copy.id}`)
  }
  catch (requestError) {
    errorMessage.value = requestError instanceof Error ? requestError.message : 'Das Format konnte nicht kopiert werden.'
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <LayoutBackLink
        to="/formate"
        label="Zurück zu den Formaten"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Format konnte nicht geladen werden"
      :description="error.message"
    />

    <template v-else-if="format">
      <LayoutPageHeader
        :title="format.name"
        :description="format.isBuiltin
          ? 'Offizielles Format – schreibgeschützt. Klone es, um eigene Regeln zu ergänzen.'
          : 'Eigenes Format'"
        truncate
      >
        <template
          v-if="format.isBuiltin"
          #actions
        >
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            label="Klonen"
            @click="cloneFormat"
          />
        </template>
      </LayoutPageHeader>

      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <FormatsRuleFormatEditor
        :key="format.id"
        :initial-values="format"
        :readonly="format.isBuiltin"
        @saved="onSaved"
      />
    </template>
  </div>
</template>
