<script setup lang="ts">
import { assistantIntentDraft } from '~/utils/assistant-intents'

useHead({ title: 'Assistent – yugioh alpha' })

const route = useRoute()
const router = useRouter()
const conversationId = computed(() => route.params.id as string)

const { data: status } = await useAssistantStatus()

// `?intent=` (set by /assistent after a deck entry point created this
// conversation, see app/utils/assistant-intents.ts) pre-fills the composer
// with a draft — never sent on its own. Read once here, since onMounted
// drops it from the URL; cleared when switching conversations.
const composerDraft = ref(assistantIntentDraft(route.query.intent))

const { data: conversationsData, refresh: refreshConversations } = await useAssistantConversations()
const conversations = computed(() => conversationsData.value?.items ?? [])

const {
  conversation,
  timeline,
  isLoading,
  loadError,
  isStreaming,
  isCancelling,
  sendError,
  load,
  send,
  cancel,
  updateAction,
} = useAssistantThread(conversationId)

// Below `lg` there's no room for the conversation list aside — it lives in
// this slideover instead, opened from the "Unterhaltungen" button in the
// thread header (mirrors app/layouts/default.vue's mobile nav drawer).
const isConversationsOpen = ref(false)

watch(conversationId, () => {
  isConversationsOpen.value = false
  composerDraft.value = ''
  load()
})

const thread = ref<{ stickToBottom: () => void } | null>(null)

async function sendMessage(payload: { text: string, images: string[] }) {
  // Sending always brings the thread back to its end (and keeps following
  // the reply), even if the user had scrolled up to reread something.
  thread.value?.stickToBottom()
  await send(payload)
  // The conversation's title (derived from its first message) and its
  // position in the list (most-recently-updated first) can both change
  // after any turn — cheap enough to just always refresh rather than
  // tracking "was this the first message".
  await refreshConversations()
}

onMounted(async () => {
  // Awaited so the optimistic echo `send()` below adds to `messages` isn't
  // immediately wiped out by this request's own response landing after it
  // (see useAssistantThread.load(), which replaces `messages` wholesale).
  await load()

  // The conversation list on this page is fetched independently from the
  // one on /assistent — refresh so a conversation just created there (or by
  // this page's own "Neue Unterhaltung") shows up right away.
  await refreshConversations()

  // A deck entry point's draft is already in the composer (see
  // `composerDraft`) — drop `?intent=` so a reload doesn't bring it back.
  if (route.query.intent !== undefined) {
    await router.replace({ query: {} })
  }

  // Coming from the /assistent empty state's example prompts: send the
  // chosen prompt once, then drop it from the URL so a reload doesn't
  // resend it.
  const promptQuery = route.query.prompt
  if (typeof promptQuery === 'string' && promptQuery !== '') {
    await router.replace({ query: {} })
    await sendMessage({ text: promptQuery, images: [] })
  }
})

async function onCreated(id: string) {
  await refreshConversations()
  await navigateTo(`/assistent/${id}`)
}

async function onDeleted(id: string) {
  await refreshConversations()
  if (id === conversationId.value) {
    const next = conversations.value[0]
    await navigateTo(next ? `/assistent/${next.id}` : '/assistent')
  }
}
</script>

<template>
  <div class="space-y-4">
    <AssistantUnavailableNotice v-if="!status?.chat" />

    <div
      v-else
      class="flex h-[calc(100dvh-8rem)] gap-4"
    >
      <aside class="hidden w-64 shrink-0 rounded-md border border-gray-200 bg-white lg:block">
        <AssistantConversationList
          :items="conversations"
          :active-id="conversationId"
          @created="onCreated"
          @deleted="onDeleted"
        />
      </aside>

      <USlideover
        v-model:open="isConversationsOpen"
        side="left"
        title="Unterhaltungen"
        class="lg:hidden"
      >
        <template #body>
          <AssistantConversationList
            :items="conversations"
            :active-id="conversationId"
            @created="onCreated"
            @deleted="onDeleted"
          />
        </template>
      </USlideover>

      <section class="flex min-w-0 flex-1 flex-col rounded-md border border-gray-200 bg-white">
        <header class="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <!-- Below `sm` the deck chip gets its own line, so neither it nor
               the title is squeezed down to a few characters. -->
          <div class="flex min-w-0 flex-1 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <h1 class="min-w-0 max-w-full truncate text-base font-semibold text-gray-900">
              {{ conversation?.title ?? 'Assistent' }}
            </h1>
            <!-- The deck this conversation is about (ADR 0011); its current
                 state is what the assistant sees on every turn. -->
            <UButton
              v-if="conversation?.deck"
              :to="`/decks/${conversation.deck.id}`"
              icon="i-lucide-layers"
              size="xs"
              color="neutral"
              variant="soft"
              class="min-w-0 max-w-full shrink sm:max-w-64"
              :aria-label="`Deck ${conversation.deck.name} öffnen`"
            >
              <span class="truncate">Deck: {{ conversation.deck.name }}</span>
            </UButton>
          </div>
          <UButton
            icon="i-lucide-menu"
            label="Unterhaltungen"
            color="neutral"
            variant="outline"
            size="xs"
            class="tap-target shrink-0 lg:hidden"
            @click="() => { isConversationsOpen = true }"
          />
        </header>

        <p
          v-if="loadError"
          class="p-4 text-sm text-red-600"
        >
          {{ loadError }}
        </p>

        <template v-else-if="!isLoading">
          <AssistantMessageThread
            ref="thread"
            :timeline="timeline"
            @action-updated="updateAction"
          />

          <p
            v-if="sendError"
            class="px-4 pb-2 text-sm text-red-600"
          >
            {{ sendError }}
          </p>

          <AssistantComposer
            :initial-text="composerDraft"
            :streaming="isStreaming"
            :cancelling="isCancelling"
            @send="sendMessage"
            @cancel="cancel"
          />
        </template>
      </section>
    </div>
  </div>
</template>
