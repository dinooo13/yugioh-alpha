<script setup lang="ts">
import type { DeckAssistantStatus } from '~~/shared/deck-assistant'

useHead({ title: 'Assistent – yugioh alpha' })

const route = useRoute()
const router = useRouter()
const conversationId = computed(() => route.params.id as string)

const { data: status } = await useFetch<DeckAssistantStatus>('/api/assistant/status', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }),
})

const { data: conversationsData, refresh: refreshConversations } = await useAssistantConversations()
const conversations = computed(() => conversationsData.value?.items ?? [])

const {
  conversation,
  timeline,
  isLoading,
  loadError,
  isStreaming,
  sendError,
  load,
  send,
  cancel,
  updateAction,
} = useAssistantThread(conversationId)

watch(conversationId, () => {
  load()
}, { immediate: true })

onMounted(async () => {
  // The conversation list on this page is fetched independently from the
  // one on /assistent — refresh so a conversation just created there (or by
  // this page's own "Neue Unterhaltung") shows up right away.
  await refreshConversations()

  // Coming from the /assistent empty state's example prompts: send the
  // chosen prompt once, then drop it from the URL so a reload doesn't
  // resend it.
  const promptQuery = route.query.prompt
  if (typeof promptQuery === 'string' && promptQuery !== '') {
    await router.replace({ query: {} })
    await send({ text: promptQuery, images: [] })
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
    <UAlert
      v-if="!status?.chat"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Der KI-Assistent ist nicht konfiguriert. Setze NUXT_ASSISTANT_API_KEY (oder OPENAI_API_KEY) bzw. NUXT_ASSISTANT_BASE_URL auf dem Server."
    />

    <div
      v-else
      class="flex h-[calc(100vh-8rem)] gap-4"
    >
      <aside class="hidden w-64 shrink-0 rounded-md border border-gray-200 bg-white lg:block">
        <AssistantConversationList
          :items="conversations"
          :active-id="conversationId"
          @created="onCreated"
          @deleted="onDeleted"
        />
      </aside>

      <section class="flex min-w-0 flex-1 flex-col rounded-md border border-gray-200 bg-white">
        <header class="border-b border-gray-200 px-4 py-3">
          <h1 class="truncate text-base font-semibold text-gray-900">
            {{ conversation?.title ?? 'Assistent' }}
          </h1>
        </header>

        <p
          v-if="loadError"
          class="p-4 text-sm text-red-600"
        >
          {{ loadError }}
        </p>

        <template v-else-if="!isLoading">
          <AssistantMessageThread
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
            :streaming="isStreaming"
            @send="send"
            @cancel="cancel"
          />
        </template>
      </section>
    </div>
  </div>
</template>
