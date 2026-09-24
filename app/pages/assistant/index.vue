<script setup lang="ts">
import type { AssistantConversationSummary } from '~~/shared/assistant-chat'
import { isAssistantIntent } from '~/utils/assistant-intents'

usePageTitle('assistant.title')

const { t } = useI18n()
const apiError = useApiError()

// Same three examples as docs/Roadmap.md's Phase 8 write-up — a bare chat
// input is intimidating on first visit, so give the user something to
// click instead of a blank page. Sent as the user's message, so they are
// in the interface language.
const EXAMPLE_PROMPT_KEYS = ['inventory', 'deck', 'photo'] as const
const examplePrompts = computed(() => EXAMPLE_PROMPT_KEYS.map(key => t(`assistant.index.examples.${key}`)))

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
  await navigateTo(`/assistant/${conversations.value!.items[0]!.id}`)
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
    await navigateTo(`/assistant/${conversation.id}?intent=${startIntent}`, { replace: true })
  }
  catch (error) {
    errorMessage.value = apiError(error, 'assistant.conversations.errors.create')
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
    await navigateTo({ path: `/assistant/${conversation.id}`, query: { prompt } })
  }
  catch (error) {
    errorMessage.value = apiError(error, 'assistant.conversations.errors.create')
  }
  finally {
    isCreating.value = false
  }
}

// The primary action in the empty state: an empty conversation, no message
// sent — unlike the example prompts below, which pass `?prompt=` so the
// conversation page sends it once on load (see app/pages/assistant/[id].vue).
async function startEmpty() {
  if (isCreating.value) {
    return
  }
  isCreating.value = true
  try {
    const conversation = await createConversation()
    await navigateTo(`/assistant/${conversation.id}`)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'assistant.conversations.errors.create')
  }
  finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ t('assistant.title') }}
      </h1>
      <p class="mt-1 max-w-prose text-sm text-muted">
        {{ t('assistant.index.intro') }}
      </p>
    </div>

    <AssistantUnavailableNotice v-if="!status?.chat" />

    <p
      v-else-if="isStarting"
      class="text-sm text-muted"
      role="status"
    >
      {{ t('assistant.index.preparing') }}
    </p>

    <template v-else>
      <p
        v-if="errorMessage"
        class="text-sm text-error"
      >
        {{ errorMessage }}
      </p>

      <UButton
        icon="i-lucide-plus"
        :label="t('assistant.conversations.new')"
        size="lg"
        :loading="isCreating"
        @click="startEmpty"
      />

      <div class="grid gap-3 sm:grid-cols-3">
        <button
          v-for="prompt in examplePrompts"
          :key="prompt"
          type="button"
          class="rounded-md border border-default bg-default p-4 text-left text-sm text-default transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          :disabled="isCreating"
          @click="startWithPrompt(prompt)"
        >
          {{ prompt }}
        </button>
      </div>
    </template>
  </div>
</template>
