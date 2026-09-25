<script setup lang="ts">
import type { AssistantConversationSummary } from '~~/shared/assistant-chat'
import type { AssistantUIMessage } from '~~/shared/assistant-ui'
import { ASSISTANT_MODEL_COOKIE, assistantModelLabel } from '~/utils/assistant-models'
import { isToolPart } from '~/utils/assistant-tool-activity'

// One conversation's thread and composer on the AI SDK's chat client and
// Nuxt UI's chat components (docs/adr/0020-assistant-on-the-ai-sdk.md). Keyed
// by the conversation id in the page, so every conversation gets its own
// chat. Each message is rendered from its parts, in order: text, the
// model's reasoning (collapsed, also while streaming — #128), tool chips and
// proposals.

const props = withDefaults(defineProps<{
  conversationId: string
  /** Sent once the conversation is loaded (an example prompt from /assistant). */
  initialPrompt?: string
  /** The models the user may pick from (the server's list) and its default. */
  models?: string[]
  defaultModel?: string | null
}>(), {
  initialPrompt: '',
  models: () => [],
  defaultModel: null,
})

const emit = defineEmits<{
  /** The conversation's summary, once loaded (its title). */
  loaded: [conversation: AssistantConversationSummary]
  /** A turn ended (however): its title and place in the list may have changed. */
  turnEnd: []
  /** The model named the conversation (#129): its title changed. */
  titleChange: []
}>()

const { t } = useI18n()

// --- Model picker: remembered on this device, else the server's default ---

const modelCookie = useCookie<string | null>(ASSISTANT_MODEL_COOKIE, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', path: '/' })
const canPickModel = computed(() => props.models.length > 1)
const selectedModel = computed<string | null>({
  get: () => modelCookie.value && props.models.includes(modelCookie.value)
    ? modelCookie.value
    : props.defaultModel ?? props.models[0] ?? null,
  set: (id) => {
    modelCookie.value = id
  },
})

const {
  conversation,
  messages,
  status,
  errorText,
  isLoading,
  loadError,
  isCancelling,
  load,
  send,
  stop,
  retry,
  regenerate,
  updateAction,
  actionView,
} = useAssistantChat(props.conversationId, {
  model: () => canPickModel.value ? selectedModel.value ?? undefined : undefined,
  onTurnEnd: () => emit('turnEnd'),
  onTitleChange: () => emit('titleChange'),
})

// `step-start` parts only mark the model's steps; a message with nothing
// else (yet) isn't shown, so the "typing" indicator stays until there is.
const threadMessages = computed<AssistantUIMessage[]>(() => messages.value.map(message => ({
  ...message,
  parts: message.parts.filter(part => part.type !== 'step-start'),
})))

const isTurnRunning = computed(() => status.value === 'submitted' || status.value === 'streaming')
const lastMessageId = computed(() => messages.value.at(-1)?.id)

/** The model under an answer — only worth a note when there's a choice, or it isn't the default. */
function answerModel(message: AssistantUIMessage): string | null {
  const model = message.metadata?.model
  if (!model || (!canPickModel.value && model === props.defaultModel)) {
    return null
  }
  return assistantModelLabel(model)
}

/** "Neu erzeugen" on the last answer: while no turn runs, and none of its proposals was applied or rejected yet. */
function canRegenerate(message: AssistantUIMessage): boolean {
  return message.id === lastMessageId.value
    && !isTurnRunning.value
    && status.value !== 'error'
    && message.parts.every(part => part.type !== 'data-action' || actionView(part.data).status === 'pending')
}

// `aria-label` is a native attribute the button passes through; its props
// type only knows button props.
const autoScrollButton = computed(() => ({ 'aria-label': t('assistant.thread.scrollToBottom') }) as Record<string, string>)

onMounted(async () => {
  await load()
  if (props.initialPrompt !== '' && !loadError.value) {
    await send({ text: props.initialPrompt, files: [] })
  }
})

watch(conversation, (summary) => {
  if (summary) {
    emit('loaded', summary)
  }
})
</script>

<template>
  <p
    v-if="loadError"
    class="p-4 text-sm text-error"
  >
    {{ loadError }}
  </p>

  <template v-else-if="!isLoading">
    <div
      data-testid="assistant-thread"
      class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4"
    >
      <p
        v-if="threadMessages.length === 0"
        class="text-sm text-muted"
      >
        {{ t('assistant.thread.empty') }}
      </p>

      <UChatMessages
        :messages="threadMessages"
        :status="status"
        should-auto-scroll
        :auto-scroll="autoScrollButton"
        :assistant="{ icon: 'i-lucide-sparkles', variant: 'naked', side: 'left' }"
        :user="{ variant: 'solid', side: 'right' }"
      >
        <template #files="{ parts }">
          <img
            v-for="(part, index) in parts"
            :key="index"
            :src="part.url"
            :alt="t('assistant.thread.photo', { index: index + 1 })"
            class="size-16 rounded-md object-cover ring-1 ring-default"
          >
        </template>

        <template #content="{ message }">
          <template v-if="message.role === 'user'">
            <ul
              v-if="message.parts.some(part => part.type === 'data-image')"
              class="mb-1.5 flex flex-wrap gap-1"
            >
              <template
                v-for="(part, index) in message.parts"
                :key="index"
              >
                <li
                  v-if="part.type === 'data-image'"
                  class="inline-flex items-center gap-1 rounded-full bg-on-primary/15 px-2 py-0.5 text-xs"
                >
                  <UIcon
                    name="i-lucide-image"
                    class="size-3"
                  />
                  {{ t('assistant.thread.photo', { index: part.data.index }) }}
                </li>
              </template>
            </ul>
            <template
              v-for="(part, index) in message.parts"
              :key="index"
            >
              <AssistantMessageText
                v-if="part.type === 'text' && part.text !== ''"
                :text="part.text"
              />
            </template>
          </template>

          <template v-else>
            <template
              v-for="(part, index) in message.parts"
              :key="`${message.id}-${index}`"
            >
              <AssistantMessageText
                v-if="part.type === 'text' && part.text.trim() !== ''"
                :text="part.text"
                markdown
                :streaming="part.state === 'streaming' && isTurnRunning && message.id === lastMessageId"
                class="w-fit max-w-full rounded-2xl rounded-bl-md bg-elevated px-3.5 py-2.5 text-default ring-1 ring-default sm:max-w-[85%]"
              />
              <AssistantReasoning
                v-else-if="part.type === 'reasoning'"
                :text="part.text"
                :streaming="part.state === 'streaming' && isTurnRunning && message.id === lastMessageId"
              />
              <AssistantToolPart
                v-else-if="isToolPart(part)"
                :part="part"
              />
              <AssistantActionCard
                v-else-if="part.type === 'data-action'"
                :action="actionView(part.data)"
                @updated="updateAction"
              />
            </template>

            <div
              v-if="answerModel(message) || canRegenerate(message)"
              class="flex items-center gap-2 text-xs text-muted"
            >
              <span
                v-if="answerModel(message)"
                data-testid="assistant-answer-model"
              >{{ answerModel(message) }}</span>
              <UButton
                v-if="canRegenerate(message)"
                icon="i-lucide-refresh-cw"
                :label="t('assistant.thread.regenerate')"
                color="neutral"
                variant="link"
                size="xs"
                class="px-0"
                @click="regenerate"
              />
            </div>
          </template>
        </template>
      </UChatMessages>
    </div>

    <p
      v-if="errorText"
      class="px-4 pb-2 text-sm text-error"
      role="alert"
    >
      {{ errorText }}
    </p>

    <AssistantComposer
      v-model:model="selectedModel"
      :status="status"
      :cancelling="isCancelling"
      :models="canPickModel ? models : []"
      @send="send"
      @stop="stop"
      @retry="retry"
    />
  </template>
</template>
