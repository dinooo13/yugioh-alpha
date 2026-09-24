import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import type { AssistantActionView, AssistantConversationSummary } from '~~/shared/assistant-chat'
import type { AssistantUIConversation, AssistantUIMessage, AssistantUIMessagePart } from '~~/shared/assistant-ui'
import { assistantChatErrorCode, isAssistantConnectionError, isAssistantHttpError } from '~/utils/assistant-chat-error'

export interface UseAssistantChatOptions {
  /** The model the next turn should use (the picker's choice), read when a message is sent; undefined = the server's default. */
  model?: () => string | undefined
  /** After every turn, however it ended: the conversation's title and position in the list may have changed. */
  onTurnEnd?: () => void | Promise<void>
}

/** A message id the server accepts as its own (a UUID); `crypto.randomUUID` only exists in secure contexts. */
function newMessageId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0F) | 0x40
  bytes[8] = (bytes[8]! & 0x3F) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function messageText(message: AssistantUIMessage | undefined): string {
  return (message?.parts ?? []).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n')
}

/** Whether an answer still has a tool call without its result — a turn that ended midway (cancelled, timed out, failed). */
export function hasUnfinishedToolCall(message: AssistantUIMessage | undefined): boolean {
  return message?.role === 'assistant' && message.parts.some(part =>
    part.type.startsWith('tool-') && 'state' in part && (part.state === 'input-streaming' || part.state === 'input-available'))
}

/**
 * Whether the server has stored the turn that just ended midway: its answer
 * is the last message, with every tool call finished (the server closes the
 * open ones as failed), and — for a cancelled turn whose answer had started
 * streaming here — it now reads differently (the server appended
 * "(abgebrochen)" to it).
 */
export function isEndedTurnStored(local: AssistantUIMessage[], stored: AssistantUIMessage[], cancelled: boolean): boolean {
  const last = stored.at(-1)
  if (last?.role !== 'assistant' || hasUnfinishedToolCall(last)) {
    return false
  }
  if (!cancelled) {
    return true
  }
  const streamed = local.find(message => message.id === last.id)
  return !streamed || messageText(streamed) !== messageText(last)
}

const REFETCH_ATTEMPTS = 8
const REFETCH_DELAY_MS = 300

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * One conversation on the AI SDK's chat client (docs/adr/0020-assistant-on-the-ai-sdk.md):
 * loads its messages (`GET …/messages`), sends a turn to
 * `POST /api/assistant/chat/:id/stream` — only the newest message; the
 * server reads the history from the database — and exposes the SDK's
 * messages, status and error. On top of the SDK:
 * - the error as a text in the interface language (ADR 0014);
 * - "Abbrechen": after the stream is stopped, the stored turn is fetched
 *   again, so the server's partial answer with "(abgebrochen)" shows — as
 *   is a turn that ended with a tool call still running (a timeout or an
 *   error), so no chip keeps loading;
 * - retry after an error: a message the server never got is sent again,
 *   else the answer is regenerated;
 * - proposals applied or rejected in the thread (`updateAction`), which
 *   win over the streamed or loaded state of their `data-action` part.
 *
 * Call it once per conversation (the thread component is keyed by the id).
 */
export function useAssistantChat(conversationId: string, options: UseAssistantChatOptions = {}) {
  const { t } = useI18n()
  const apiError = useApiError()
  const apiErrorCode = useApiErrorCode()

  const conversation = shallowRef<AssistantConversationSummary | null>(null)
  const isLoading = ref(true)
  const loadError = ref('')
  const isCancelling = ref(false)
  const actionUpdates = shallowRef(new Map<string, AssistantActionView>())
  let isDisposed = false

  const chat = useChat<AssistantUIMessage>({
    id: conversationId,
    generateId: newMessageId,
    transport: new DefaultChatTransport<AssistantUIMessage>({
      api: `/api/assistant/chat/${conversationId}/stream`,
      prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
        const model = options.model?.()
        return {
          body: {
            trigger,
            ...(messageId ? { messageId } : {}),
            ...(trigger === 'submit-message' ? { message: messages.at(-1) } : {}),
            ...(model ? { model } : {}),
          },
        }
      },
    }),
    onFinish: ({ isAbort, message }) => {
      void afterTurn(isAbort, message)
    },
  })

  onScopeDispose(() => {
    isDisposed = true
  })

  function fetchConversation() {
    return $fetch<AssistantUIConversation>(`/api/assistant/chat/${conversationId}/messages`)
  }

  function applyConversation(data: AssistantUIConversation) {
    conversation.value = data.conversation
    chat.messages.value = data.messages
    actionUpdates.value = new Map()
  }

  async function load() {
    isLoading.value = true
    loadError.value = ''
    try {
      applyConversation(await fetchConversation())
    }
    catch (error) {
      loadError.value = apiError(error, 'assistant.thread.errors.load')
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * After a turn that ended midway: the server stores the answer as it got
   * it right after the stream closes (with "(abgebrochen)", open tool calls
   * closed) — fetched again once it's there.
   */
  async function refetchEndedTurn(cancelled: boolean) {
    const local = chat.messages.value
    for (let attempt = 1; attempt <= REFETCH_ATTEMPTS; attempt++) {
      await wait(attempt === 1 ? REFETCH_DELAY_MS / 2 : REFETCH_DELAY_MS)
      if (isDisposed) {
        return
      }
      let data: AssistantUIConversation
      try {
        data = await fetchConversation()
      }
      catch {
        // Keep what the thread shows; the next load brings the stored state.
        return
      }
      // Gone, or a new turn started meanwhile: that one owns the thread now.
      if (isDisposed || chat.status.value === 'submitted' || chat.status.value === 'streaming') {
        return
      }
      if (isEndedTurnStored(local, data.messages, cancelled) || attempt === REFETCH_ATTEMPTS) {
        applyConversation(data)
        return
      }
    }
  }

  async function afterTurn(isAbort: boolean, message: AssistantUIMessage) {
    try {
      if (isAbort) {
        await refetchEndedTurn(true)
      }
      else if (hasUnfinishedToolCall(message) && !isAssistantHttpError(chat.error.value)) {
        await refetchEndedTurn(false)
      }
    }
    finally {
      isCancelling.value = false
    }
    await options.onTurnEnd?.()
  }

  const isBusy = computed(() => chat.status.value === 'submitted' || chat.status.value === 'streaming' || isCancelling.value)

  /** Sends a message: its text and photos (`file` parts with data URLs). */
  async function send(input: { text: string, files: Array<{ mediaType: string, url: string }> }) {
    if (isBusy.value || (input.text === '' && input.files.length === 0)) {
      return
    }
    const parts: AssistantUIMessagePart[] = [
      ...(input.text !== '' ? [{ type: 'text' as const, text: input.text }] : []),
      ...input.files.map(file => ({ type: 'file' as const, mediaType: file.mediaType, url: file.url })),
    ]
    await chat.sendMessage({ parts })
  }

  function stop() {
    if (isCancelling.value || !(chat.status.value === 'submitted' || chat.status.value === 'streaming')) {
      return
    }
    isCancelling.value = true
    void chat.stop()
  }

  /** After an error: a message the server never received (an HTTP error before the turn began) is sent again; otherwise the answer is regenerated. */
  async function retry() {
    if (isBusy.value) {
      return
    }
    const last = chat.messages.value.at(-1)
    if (last?.role === 'user' && isAssistantHttpError(chat.error.value)) {
      chat.messages.value = chat.messages.value.slice(0, -1)
      await chat.sendMessage({ parts: last.parts })
      return
    }
    await chat.regenerate()
  }

  /** Regenerates the last answer (the server allows it while all of its proposals are still pending). */
  async function regenerate() {
    if (isBusy.value) {
      return
    }
    await chat.regenerate()
  }

  function updateAction(view: AssistantActionView) {
    const next = new Map(actionUpdates.value)
    next.set(view.id, view)
    actionUpdates.value = next
  }

  /** A proposal's current state: as applied/rejected in this thread, else as streamed or loaded. */
  function actionView(view: AssistantActionView): AssistantActionView {
    return actionUpdates.value.get(view.id) ?? view
  }

  const errorText = computed(() => {
    const error = chat.error.value
    if (!error) {
      return ''
    }
    if (isAssistantConnectionError(error)) {
      return t('assistant.thread.errors.connectionLost')
    }
    return apiErrorCode(assistantChatErrorCode(error), undefined, 'assistant.thread.errors.unexpected')
  })

  return {
    conversation,
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    errorText,
    isLoading,
    loadError,
    isBusy,
    isCancelling,
    load,
    send,
    stop,
    retry,
    regenerate,
    updateAction,
    actionView,
  }
}
