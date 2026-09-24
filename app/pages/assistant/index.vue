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
const EXAMPLE_PROMPT_ICONS = { inventory: 'i-lucide-archive', deck: 'i-lucide-layers', photo: 'i-lucide-camera' } as const
const examplePrompts = computed(() => EXAMPLE_PROMPT_KEYS.map(key => ({
  key,
  icon: EXAMPLE_PROMPT_ICONS[key],
  text: t(`assistant.index.examples.${key}`),
})))

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
  <div class="space-y-6 lg:space-y-8">
    <LayoutPageHeader
      :title="t('assistant.title')"
      :description="t('assistant.index.intro')"
    />

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

      <!-- The summoning circle: start a conversation, or pick an example. -->
      <section class="arena-surface relative overflow-hidden rounded-xl border border-default p-5 shadow-panel sm:p-8">
        <LayoutArcaneRings class="absolute -top-36 -right-32 size-[26rem] opacity-80" />
        <div class="relative flex items-center gap-4">
          <span
            class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-2 ring-secondary/60 ring-offset-2 ring-offset-bg"
            aria-hidden="true"
          >
            <UIcon
              name="i-lucide-sparkles"
              class="size-6"
            />
          </span>
          <UButton
            icon="i-lucide-plus"
            :label="t('assistant.conversations.new')"
            size="lg"
            class="btn-summon"
            :loading="isCreating"
            @click="startEmpty"
          />
        </div>

        <div class="relative mt-6 grid gap-3 sm:grid-cols-3">
          <button
            v-for="prompt in examplePrompts"
            :key="prompt.key"
            type="button"
            class="group panel flex items-start gap-3 p-4 text-left text-sm leading-6 text-default transition-[box-shadow,border-color] duration-200 hover:border-primary/50 hover:shadow-glow-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
            :disabled="isCreating"
            @click="startWithPrompt(prompt.text)"
          >
            <span
              class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/15"
              aria-hidden="true"
            >
              <UIcon
                :name="prompt.icon"
                class="size-4"
              />
            </span>
            <span class="min-w-0">{{ prompt.text }}</span>
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
