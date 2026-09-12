import { SseRequestError, readSse } from '~/utils/sse'
import { summarizeStoredToolResult, toolCallLabel } from '~/utils/assistant-tool-activity'
import { apiErrorMessage } from '~/utils/card-entry'
import type { AssistantActivityStatus, AssistantTimelineItem } from '~/utils/assistant-timeline'
import type {
  AssistantActionView,
  AssistantConversationSummary,
  AssistantMessageView,
  AssistantSseActionProposed,
  AssistantSseError,
  AssistantSseMessageEnd,
  AssistantSseTextDelta,
  AssistantSseToolCall,
  AssistantSseToolResult,
} from '~~/shared/assistant-chat'

interface ConversationDetailResponse {
  conversation: AssistantConversationSummary
  messages: AssistantMessageView[]
  actions: AssistantActionView[]
}

interface StreamingActivity {
  id: string
  label: string
  status: AssistantActivityStatus
  summary?: string
}

/**
 * Owns one conversation's data (load, send, cancel) and exposes it as a
 * single `timeline` the thread renders — merging the persisted
 * messages/actions from `GET /api/assistant/chat/:id` with whatever the
 * turn currently streaming over SSE has produced so far. See
 * `app/utils/assistant-timeline.ts` for the merged row shape and
 * `server/utils/assistant-chat.ts` for the event/persistence contract this
 * mirrors on the client.
 */
export function useAssistantThread(conversationId: Ref<string>) {
  const conversation = ref<AssistantConversationSummary | null>(null)
  const messages = ref<AssistantMessageView[]>([])
  const actions = ref<AssistantActionView[]>([])
  const isLoading = ref(true)
  const loadError = ref('')

  const isStreaming = ref(false)
  const streamingText = ref('')
  const streamingActivities = ref<StreamingActivity[]>([])
  const sendError = ref('')
  let abortController: AbortController | null = null

  async function load() {
    isLoading.value = true
    loadError.value = ''
    try {
      const detail = await $fetch<ConversationDetailResponse>(`/api/assistant/chat/${conversationId.value}`)
      conversation.value = detail.conversation
      messages.value = detail.messages
      actions.value = detail.actions
    }
    catch (error) {
      loadError.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht geladen werden.')
    }
    finally {
      isLoading.value = false
    }
  }

  const toolMessagesByCallId = computed(() => {
    const byCallId = new Map<string, AssistantMessageView>()
    for (const message of messages.value) {
      if (message.role === 'tool' && message.toolCallId) {
        byCallId.set(message.toolCallId, message)
      }
    }
    return byCallId
  })

  const timeline = computed<AssistantTimelineItem[]>(() => {
    const items: AssistantTimelineItem[] = []

    for (const message of messages.value) {
      if (message.role === 'tool') {
        continue
      }
      if (message.content !== '' || (message.attachments?.length ?? 0) > 0) {
        items.push({
          type: 'message',
          key: message.id,
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content,
          attachments: message.attachments,
        })
      }
      for (const call of message.toolCalls ?? []) {
        const toolMessage = toolMessagesByCallId.value.get(call.id)
        const resolved = toolMessage ? summarizeStoredToolResult(toolMessage.content) : undefined
        items.push({
          type: 'activity',
          key: `${message.id}-${call.id}`,
          label: toolCallLabel(call),
          status: resolved ? (resolved.ok ? 'ok' : 'error') : 'running',
          summary: resolved?.summary,
        })
      }
      for (const action of actions.value.filter(candidate => candidate.messageId === message.id)) {
        items.push({ type: 'action', key: action.id, action })
      }
    }

    if (streamingText.value !== '') {
      items.push({ type: 'message', key: 'streaming-text', role: 'assistant', content: streamingText.value })
    }
    for (const activity of streamingActivities.value) {
      items.push({
        type: 'activity',
        key: `streaming-${activity.id}`,
        label: activity.label,
        status: activity.status,
        summary: activity.summary,
      })
    }

    return items
  })

  function updateAction(action: AssistantActionView) {
    actions.value = actions.value.map(existing => existing.id === action.id ? action : existing)
  }

  async function send(input: { text: string, images: string[] }): Promise<void> {
    if (isStreaming.value) {
      return
    }

    sendError.value = ''
    isStreaming.value = true
    streamingText.value = ''
    streamingActivities.value = []
    abortController = new AbortController()

    // Optimistic local echo — replaced by the persisted row the next time
    // the conversation is (re)loaded; good enough for the current session.
    messages.value = [
      ...messages.value,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: input.text,
        ...(input.images.length > 0
          ? { attachments: input.images.map((_, index) => ({ kind: 'image' as const, label: `Foto ${index + 1}` })) }
          : {}),
        createdAt: new Date().toISOString(),
      },
    ]

    try {
      const stream = readSse(`/api/assistant/chat/${conversationId.value}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: abortController.signal,
      })

      for await (const event of stream) {
        if (event.event === 'text_delta') {
          streamingText.value += (event.data as AssistantSseTextDelta).text
        }
        else if (event.event === 'tool_call') {
          const data = event.data as AssistantSseToolCall
          streamingActivities.value = [...streamingActivities.value, { id: data.id, label: data.label, status: 'running' }]
        }
        else if (event.event === 'tool_result') {
          const data = event.data as AssistantSseToolResult
          streamingActivities.value = streamingActivities.value.map(activity => (
            activity.id === data.id ? { ...activity, status: data.ok ? 'ok' : 'error', summary: data.summary } : activity
          ))
        }
        else if (event.event === 'action_proposed') {
          const data = event.data as AssistantSseActionProposed
          actions.value = [...actions.value, data.action]
        }
        else if (event.event === 'message_end') {
          const data = event.data as AssistantSseMessageEnd
          messages.value = [...messages.value, data.message]
          streamingText.value = ''
          streamingActivities.value = []
        }
        else if (event.event === 'error') {
          sendError.value = (event.data as AssistantSseError).message
        }
      }
    }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        sendError.value = error instanceof SseRequestError
          ? error.message
          : 'Die Verbindung wurde unterbrochen. Bitte versuche es erneut.'
      }
    }
    finally {
      isStreaming.value = false
      streamingText.value = ''
      streamingActivities.value = []
      abortController = null
    }
  }

  function cancel() {
    abortController?.abort()
  }

  return {
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
  }
}
