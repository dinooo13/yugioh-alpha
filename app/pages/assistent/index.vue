<script setup lang="ts">
import type { AssistantConversationSummary } from '~~/shared/assistant-chat'
import { apiErrorMessage } from '~/utils/card-entry'
import { isAssistantIntent } from '~/utils/assistant-intents'

useHead({ title: 'Assistent – yugioh alpha' })

// Same three examples as docs/Roadmap.md's Phase 8 write-up — a bare chat
// input is intimidating on first visit, so give the user something to
// click instead of a blank page.
const EXAMPLE_PROMPTS = [
  'Welche Karten habe ich von Blue-Eyes?',
  'Baue mir ein Deck aus meinen Karten für GOAT',
  'Foto einer Karte hinzufügen',
]

const route = useRoute()
const router = useRouter()

const { data: status } = await useAssistantStatus()

const { data: conversations } = await useAssistantConversations()

// Deck entry points (docs/adr/0011-deck-assistance-in-chat.md) link here
// with `?deckId=` ("Mit KI bearbeiten") or `?intent=new-deck` ("Mit KI
// erstellen"): start a conversation for that on mount instead of showing
// the empty state or jumping to the newest thread. Plain links, so the
// side effect (creating the conversation) only ever happens client-side.
const startDeckId = typeof route.query.deckId === 'string' && route.query.deckId !== '' ? route.query.deckId : null
const startIntent = startDeckId ? 'edit-deck' : isAssistantIntent(route.query.intent) ? route.query.intent : null
const isStarting = ref(Boolean(status.value?.chat && startIntent))

// A returning user almost always wants to pick up where they left off, not
// stare at the empty state again — jump straight to the newest thread.
if (!isStarting.value && status.value?.chat && (conversations.value?.items.length ?? 0) > 0) {
  await navigateTo(`/assistent/${conversations.value!.items[0]!.id}`)
}

const isCreating = ref(false)
const errorMessage = ref('')

async function createConversation(body?: { deckId: string }): Promise<AssistantConversationSummary> {
  errorMessage.value = ''
  return $fetch<AssistantConversationSummary>('/api/assistant/chat', { method: 'POST', ...(body ? { body } : {}) })
}

onMounted(async () => {
  if (!isStarting.value || !startIntent) {
    return
  }
  try {
    const conversation = await createConversation(startDeckId ? { deckId: startDeckId } : undefined)
    await navigateTo(`/assistent/${conversation.id}?intent=${startIntent}`, { replace: true })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht erstellt werden.')
    isStarting.value = false
    await router.replace({ query: {} })
  }
})

async function startWithPrompt(prompt: string) {
  if (isCreating.value) {
    return
  }
  isCreating.value = true
  try {
    const conversation = await createConversation()
    await navigateTo({ path: `/assistent/${conversation.id}`, query: { prompt } })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht erstellt werden.')
  }
  finally {
    isCreating.value = false
  }
}

// The primary action in the empty state: an empty conversation, no message
// sent — unlike the example prompts below, which pass `?prompt=` so the
// conversation page sends it once on load (see app/pages/assistent/[id].vue).
async function startEmpty() {
  if (isCreating.value) {
    return
  }
  isCreating.value = true
  try {
    const conversation = await createConversation()
    await navigateTo(`/assistent/${conversation.id}`)
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

    <AssistantUnavailableNotice v-if="!status?.chat" />

    <p
      v-else-if="isStarting"
      class="text-sm text-gray-500"
      role="status"
    >
      Unterhaltung wird vorbereitet …
    </p>

    <template v-else>
      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <UButton
        icon="i-lucide-plus"
        label="Neue Unterhaltung"
        size="lg"
        :loading="isCreating"
        @click="startEmpty"
      />

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
