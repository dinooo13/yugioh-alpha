import { SseRequestError, readSse } from '~/utils/sse'
import { summarizeStoredToolResult, toolCallLabel } from '~/utils/assistant-tool-activity'
import { apiErrorMessage } from '~/utils/card-entry'
import type { AssistantActivityStatus, AssistantTimelineItem } from '~/utils/assistant-timeline'
import type {
  AssistantActionView,
  AssistantConversationSummary,
  AssistantMessageView,
} from '~~/shared/assistant-chat'

interface ConversationDetailResponse {
  conversation: AssistantConversationSummary
  messages: AssistantMessageView[]
  actions: AssistantActionView[]
}

/**
 * One row produced by the turn currently streaming, in the exact order its
 * SSE events arrived — text deltas coalesce into the trailing text item,
 * a `tool_call` opens a new activity item, and an `action_proposed` is
 * appended immediately so its card shows up without waiting for the turn to
 * finish. Replaced wholesale by `refresh()` once `message_end` arrives, so the
 * live rendering never has to be reconciled with the persisted one — it's
 * simply swapped out for it.
 */
type StreamingItem =
  | { type: 'text', key: string, text: string }
  | { type: 'activity', key: string, id: string, label: string, status: AssistantActivityStatus, summary?: string }
  | { type: 'action', key: string, action: AssistantActionView }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Runtime guards for each SSE event payload — a malformed/truncated event
 * (see app/utils/sse.ts's trailing-flush) must be ignored rather than
 * appending `undefined` to the visible answer or crashing the reader. */

function isTextDelta(data: unknown): data is { text: string } {
  return isRecord(data) && typeof data.text === 'string'
}

function isToolCall(data: unknown): data is { id: string, name: string, label: string } {
  return isRecord(data) && typeof data.id === 'string' && typeof data.name === 'string' && typeof data.label === 'string'
}

function isToolResult(data: unknown): data is { id: string, ok: boolean, summary: string } {
  return isRecord(data) && typeof data.id === 'string' && typeof data.ok === 'boolean' && typeof data.summary === 'string'
}

function isActionView(value: unknown): value is AssistantActionView {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.messageId === 'string'
    && typeof value.kind === 'string'
    && typeof value.summary === 'string'
    && isRecord(value.payload)
    && typeof value.status === 'string'
}

function isActionProposed(data: unknown): data is { action: AssistantActionView } {
  return isRecord(data) && isActionView(data.action)
}

function isMessageView(value: unknown): value is AssistantMessageView {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant' || value.role === 'tool')
    && typeof value.content === 'string'
    && typeof value.createdAt === 'string'
}

function isMessageEnd(data: unknown): data is { message: AssistantMessageView } {
  return isRecord(data) && isMessageView(data.message)
}

function isErrorPayload(data: unknown): data is { message: string } {
  return isRecord(data) && typeof data.message === 'string'
}

/** Aborting a fetch/body read surfaces as `DOMException` in browsers but as
 * a plain `Error`/`TypeError` with the same `name` in some runtimes (undici,
 * test environments) — check the name directly rather than the class. */
function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
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
  const isCancelling = ref(false)
  const streamingItems = ref<StreamingItem[]>([])
  const sendError = ref('')
  let abortController: AbortController | null = null
  let streamingTextCounter = 0

  function fetchDetail(id: string) {
    return $fetch<ConversationDetailResponse>(`/api/assistant/chat/${id}`)
  }

  function applyDetail(detail: ConversationDetailResponse) {
    conversation.value = detail.conversation
    messages.value = detail.messages
    actions.value = detail.actions
  }

  /**
   * Full (re)load for the initial mount and conversation switches — flips
   * `isLoading`, which the page uses to hide the thread and composer until
   * the conversation is there. Never call this mid-conversation: hiding the
   * thread unmounts it, and the remounted one starts scrolled to the top.
   */
  async function load() {
    isLoading.value = true
    loadError.value = ''
    try {
      applyDetail(await fetchDetail(conversationId.value))
    }
    catch (error) {
      loadError.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht geladen werden.')
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Background re-sync after a turn: swaps the live streaming rows for the
   * persisted ones in a single synchronous step once the response is in,
   * so the thread stays mounted and never shrinks and regrows in between.
   * Leaves `isLoading`/`loadError` alone — a failure only surfaces as a
   * `sendError` and keeps whatever the thread already shows.
   */
  async function refresh() {
    const id = conversationId.value
    try {
      const detail = await fetchDetail(id)
      if (id !== conversationId.value) {
        // Switched conversations while this was in flight — `load()` for
        // the new one owns the thread now.
        return
      }
      applyDetail(detail)
      streamingItems.value = []
    }
    catch (error) {
      sendError.value = apiErrorMessage(error, 'Die Unterhaltung konnte nicht aktualisiert werden.')
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

    // The turn currently streaming, in arrival order — a tool round can
    // precede or follow answer text any number of times, unlike the fixed
    // "one bubble then all chips" shape a reloaded turn happens to render
    // as today (every reload so far only ever produced trailing text after
    // its tool calls).
    for (const item of streamingItems.value) {
      if (item.type === 'text') {
        if (item.text !== '') {
          items.push({ type: 'message', key: item.key, role: 'assistant', content: item.text })
        }
      }
      else if (item.type === 'activity') {
        items.push({ type: 'activity', key: item.key, label: item.label, status: item.status, summary: item.summary })
      }
      else {
        items.push({ type: 'action', key: item.key, action: item.action })
      }
    }

    return items
  })

  function updateAction(action: AssistantActionView) {
    actions.value = actions.value.map(existing => existing.id === action.id ? action : existing)
    streamingItems.value = streamingItems.value.map(item =>
      item.type === 'action' && item.action.id === action.id ? { ...item, action } : item)
  }

  function appendStreamingText(text: string) {
    const items = streamingItems.value
    const last = items[items.length - 1]
    if (last && last.type === 'text') {
      streamingItems.value = [...items.slice(0, -1), { ...last, text: last.text + text }]
      return
    }
    streamingTextCounter += 1
    streamingItems.value = [...items, { type: 'text', key: `streaming-text-${streamingTextCounter}`, text }]
  }

  function appendStreamingActivity(data: { id: string, label: string }) {
    streamingItems.value = [
      ...streamingItems.value,
      { type: 'activity', key: `streaming-activity-${data.id}`, id: data.id, label: data.label, status: 'running' },
    ]
  }

  function updateStreamingActivity(data: { id: string, ok: boolean, summary: string }) {
    streamingItems.value = streamingItems.value.map(item => (
      item.type === 'activity' && item.id === data.id
        ? { ...item, status: data.ok ? 'ok' : 'error', summary: data.summary }
        : item
    ))
  }

  function appendStreamingAction(action: AssistantActionView) {
    streamingItems.value = [...streamingItems.value, { type: 'action', key: `streaming-action-${action.id}`, action }]
  }

  async function send(input: { text: string, images: string[] }): Promise<void> {
    if (isStreaming.value) {
      return
    }

    sendError.value = ''
    isCancelling.value = false
    isStreaming.value = true
    streamingItems.value = []
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

    let shouldReloadAfterCancel = false

    try {
      const stream = readSse(`/api/assistant/chat/${conversationId.value}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: abortController.signal,
      })

      for await (const event of stream) {
        if (event.event === 'text_delta') {
          if (isTextDelta(event.data)) {
            appendStreamingText(event.data.text)
          }
        }
        else if (event.event === 'tool_call') {
          if (isToolCall(event.data)) {
            appendStreamingActivity(event.data)
          }
        }
        else if (event.event === 'tool_result') {
          if (isToolResult(event.data)) {
            updateStreamingActivity(event.data)
          }
        }
        else if (event.event === 'action_proposed') {
          if (isActionProposed(event.data)) {
            appendStreamingAction(event.data.action)
          }
        }
        else if (event.event === 'message_end') {
          if (isMessageEnd(event.data)) {
            // Re-sync from the server instead of appending the final
            // message ourselves: the persisted timeline also has the
            // intermediate assistant/tool rows (pre-tool-call text, tool
            // chips) and any actions attached to them, none of which the
            // live stream carries a full copy of. `refresh()` swaps the
            // streamed rows for the persisted ones atomically and without
            // unmounting the thread (see its JSDoc).
            await refresh()
          }
        }
        else if (event.event === 'error') {
          if (isErrorPayload(event.data)) {
            sendError.value = event.data.message
          }
        }
      }
    }
    catch (error) {
      if (isAbortError(error)) {
        // The persisted turn (however far it got before "Abbrechen") is
        // only visible after a reload — the stream itself is dead now.
        shouldReloadAfterCancel = true
      }
      else {
        sendError.value = error instanceof SseRequestError
          ? error.message
          : 'Die Verbindung wurde unterbrochen. Bitte versuche es erneut.'
      }
    }
    finally {
      abortController = null
    }

    // Reloading before clearing `isStreaming`/`isCancelling` keeps the
    // composer in its "wird abgebrochen…" state for the whole round trip,
    // instead of flashing back to normal for the moment between the abort
    // landing and the persisted (partial) turn showing up. The streamed
    // rows stay visible until then, so the thread doesn't shrink and
    // regrow; whatever is left (error paths, a failed refresh, a stream
    // that ended without `message_end`) is cleared afterwards.
    if (shouldReloadAfterCancel) {
      await refresh()
    }
    streamingItems.value = []
    isStreaming.value = false
    isCancelling.value = false
  }

  function cancel() {
    isCancelling.value = true
    abortController?.abort()
  }

  return {
    conversation,
    timeline,
    isLoading,
    loadError,
    isStreaming,
    isCancelling,
    sendError,
    load,
    refresh,
    send,
    cancel,
    updateAction,
  }
}
