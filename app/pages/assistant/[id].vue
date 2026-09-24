<script setup lang="ts">
import { deckConversationTitle } from '~~/shared/assistant-chat'
import { assistantIntentDraftKey } from '~/utils/assistant-intents'

usePageTitle('assistant.title')

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const conversationId = computed(() => route.params.id as string)

const { data: status } = await useAssistantStatus()

// `?intent=` (set by /assistant after a deck entry point created this
// conversation, see app/utils/assistant-intents.ts) pre-fills the composer
// with a draft — never sent on its own. Read once here, since onMounted
// drops it from the URL; cleared when switching conversations.
const draftKey = assistantIntentDraftKey(route.query.intent)
const composerDraft = ref(draftKey ? t(draftKey) : '')

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

// A deck conversation's title starts out as "Deck: <name>" — exactly the
// deck chip's text. While it still is, the chip alone is the visible title
// and the <h1> stays for screen readers only (#48). Once the title differs
// (the deck was renamed, or the title was replaced), both are shown.
const isDefaultDeckTitle = computed(() => {
  const current = conversation.value
  return Boolean(current?.deck) && current!.title === deckConversationTitle(current!.deck!.name)
})

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
  // one on /assistant — refresh so a conversation just created there (or by
  // this page's own "Neue Unterhaltung") shows up right away.
  await refreshConversations()

  // A deck entry point's draft is already in the composer (see
  // `composerDraft`) — drop `?intent=` so a reload doesn't bring it back.
  if (route.query.intent !== undefined) {
    await router.replace({ query: {} })
  }

  // Coming from the /assistant empty state's example prompts: send the
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
  await navigateTo(`/assistant/${id}`)
}

async function onDeleted(id: string) {
  await refreshConversations()
  if (id === conversationId.value) {
    const next = conversations.value[0]
    await navigateTo(next ? `/assistant/${next.id}` : '/assistant')
  }
}
</script>

<template>
  <!-- Exactly the height below the mobile header (56px) and the main
       padding (2 × 16px; 2 × 32px from lg), so the page itself never scrolls:
       the thread scrolls inside and the composer stays in view. -->
  <div class="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-4 lg:h-[calc(100dvh-4rem)] lg:gap-6">
    <!-- While the title is still the default "Deck: <name>", the <h1> is
         sr-only and the deck chip is the visible title, so it isn't shown
         twice (#48). -->
    <LayoutPageHeader
      :eyebrow="t('assistant.title')"
      :hide-title="isDefaultDeckTitle"
      truncate
      class="shrink-0 max-sm:flex-row max-sm:items-start max-sm:gap-3"
    >
      <template #title>
        {{ conversation?.title ?? t('assistant.title') }}
      </template>
      <!-- The deck this conversation is about (ADR 0011); its current state
           is what the assistant sees on every turn. -->
      <UButton
        v-if="status?.chat && conversation?.deck"
        :to="`/decks/${conversation.deck.id}`"
        icon="i-lucide-layers"
        :size="isDefaultDeckTitle ? 'md' : 'xs'"
        color="neutral"
        variant="soft"
        class="max-w-full min-w-0"
        :class="isDefaultDeckTitle ? 'mt-0.5' : 'mt-2'"
        :aria-label="t('assistant.thread.openDeck', { name: conversation.deck.name })"
      >
        <span class="truncate">{{ t('assistant.thread.deckChip', { name: conversation.deck.name }) }}</span>
      </UButton>

      <template
        v-if="status?.chat"
        #actions
      >
        <!-- Icon-only on phones, so the title keeps its row. -->
        <UButton
          icon="i-lucide-messages-square"
          :label="t('assistant.conversations.title')"
          :aria-label="t('assistant.conversations.title')"
          :ui="{ label: 'max-sm:sr-only' }"
          color="neutral"
          variant="outline"
          class="tap-target lg:hidden"
          @click="() => { isConversationsOpen = true }"
        />
      </template>
    </LayoutPageHeader>

    <AssistantUnavailableNotice v-if="!status?.chat" />

    <div
      v-else
      class="flex min-h-0 flex-1 gap-4"
    >
      <aside class="panel hidden w-64 shrink-0 overflow-hidden lg:block">
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
        :title="t('assistant.conversations.title')"
        class="lg:hidden"
        :ui="{ body: 'p-0 sm:p-0' }"
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

      <section class="panel flex min-w-0 flex-1 flex-col overflow-hidden">
        <p
          v-if="loadError"
          class="p-4 text-sm text-error"
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
            class="px-4 pb-2 text-sm text-error"
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
