<script setup lang="ts">
import type { DeckAssistantStatus } from '~~/shared/deck-assistant'
import { apiErrorMessage } from '~/utils/card-entry'

useHead({ title: 'Assistent – yugioh alpha' })

// Same three examples as docs/Roadmap.md's Phase 8 write-up — a bare chat
// input is intimidating on first visit, so give the user something to
// click instead of a blank page.
const EXAMPLE_PROMPTS = [
  'Welche Karten habe ich von Blue-Eyes?',
  'Baue mir ein Deck aus meinen Karten für GOAT',
  'Foto einer Karte hinzufügen',
]

const { data: status } = await useFetch<DeckAssistantStatus>('/api/assistant/status', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }),
})

const { data: conversations } = await useAssistantConversations()

// A returning user almost always wants to pick up where they left off, not
// stare at the empty state again — jump straight to the newest thread.
if (status.value?.chat && (conversations.value?.items.length ?? 0) > 0) {
  await navigateTo(`/assistent/${conversations.value!.items[0]!.id}`)
}

const isCreating = ref(false)
const errorMessage = ref('')

async function startWithPrompt(prompt: string) {
  if (isCreating.value) {
    return
  }
  isCreating.value = true
  errorMessage.value = ''
  try {
    const conversation = await $fetch<{ id: string }>('/api/assistant/chat', { method: 'POST' })
    await navigateTo({ path: `/assistent/${conversation.id}`, query: { prompt } })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht erstellt werden.')
  }
  finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-gray-900">
        Assistent
      </h1>
      <p class="mt-1 max-w-prose text-sm text-gray-500">
        Frag den Assistenten nach deinem Inventar, deinen Decks oder lass ihn eine Karte per Foto erkennen — er
        schlägt Änderungen vor, die du erst bestätigen musst.
      </p>
    </div>

    <UAlert
      v-if="!status?.chat"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Der KI-Assistent ist nicht konfiguriert. Setze NUXT_ASSISTANT_API_KEY (oder OPENAI_API_KEY) bzw. NUXT_ASSISTANT_BASE_URL auf dem Server."
    />

    <template v-else>
      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <div class="grid gap-3 sm:grid-cols-3">
        <button
          v-for="prompt in EXAMPLE_PROMPTS"
          :key="prompt"
          type="button"
          class="rounded-md border border-gray-200 bg-white p-4 text-left text-sm text-gray-700 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          :disabled="isCreating"
          @click="startWithPrompt(prompt)"
        >
          {{ prompt }}
        </button>
      </div>
    </template>
  </div>
</template>
