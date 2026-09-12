import { and, eq } from 'drizzle-orm'
import { createError, createEventStream, getRequestHeader, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { assistantConversation } from '../../../../db/schema'
import { useDeckAssistantModel } from '../../../../utils/deck-assistant-model'
import { runChatTurn, validateAssistantMessageInput } from '../../../../utils/assistant-chat'
import type { AssistantMessageInput, ChatTurnEvent } from '../../../../utils/assistant-chat'
import { requireUser } from '../../../../utils/session'
import { claimTurnLock, isTurnInFlight, releaseTurnLock } from '../../../../utils/assistant-turn-lock'
import { ASSISTANT_MESSAGE_TOTAL_BYTES_MAX } from '../../../../../shared/assistant-chat'

// A little over the encoded-image cap plus the rest of the JSON body (text
// field, array brackets, field names) — generous enough for any legitimate
// request, tight enough to reject an oversized body via `content-length`
// *before* `readBody` buffers it into memory.
const MAX_REQUEST_BODY_BYTES = ASSISTANT_MESSAGE_TOTAL_BYTES_MAX + 8192

function sseEventName(turnEvent: ChatTurnEvent): string {
  return turnEvent.type
}

function sseEventData(turnEvent: ChatTurnEvent): unknown {
  switch (turnEvent.type) {
    case 'message_start':
      return { userMessageId: turnEvent.userMessageId }
    case 'text_delta':
      return { text: turnEvent.text }
    case 'tool_call':
      return { id: turnEvent.id, name: turnEvent.name, label: turnEvent.label }
    case 'tool_result':
      return { id: turnEvent.id, ok: turnEvent.ok, summary: turnEvent.summary }
    case 'action_proposed':
      return { action: turnEvent.action }
    case 'message_end':
      return { message: turnEvent.message }
    case 'error':
      return { message: turnEvent.message }
  }
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Unterhaltung nicht gefunden.' })
  }

  const user = await requireUser(event)
  const db = useDb()

  const conversationRow = db
    .select({ id: assistantConversation.id })
    .from(assistantConversation)
    .where(and(eq(assistantConversation.id, id), eq(assistantConversation.userId, user.id)))
    .get()
  if (!conversationRow) {
    throw createError({ statusCode: 404, statusMessage: 'Unterhaltung nicht gefunden.' })
  }

  const model = useDeckAssistantModel()
  if (!model) {
    throw createError({ statusCode: 503, statusMessage: 'KI-Assistent ist nicht konfiguriert.' })
  }

  // Claimed right after the check, before `readBody` — otherwise two
  // near-simultaneous submits could both pass the check while the first is
  // still awaiting the body, and both would start a turn. Every exit path
  // below (including a validation/size error) releases it again; once
  // `runChatTurn` is handed the lock, its own `finally` releases it.
  if (isTurnInFlight(user.id)) {
    throw createError({ statusCode: 409, statusMessage: 'Es läuft bereits eine Anfrage.' })
  }
  claimTurnLock(user.id)

  let input: AssistantMessageInput
  try {
    // `content-length` is checked before the body is ever read into memory —
    // the precise 4 MB/3-image validation below still runs afterwards, this
    // only rejects a body that's already unreasonable up front.
    const contentLength = Number(getRequestHeader(event, 'content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Die Anfrage ist zu groß.' })
    }
    input = validateAssistantMessageInput(await readBody(event))
  }
  catch (error) {
    releaseTurnLock(user.id)
    throw error
  }

  const stream = createEventStream(event)

  // Ties the turn's lifetime to the SSE connection: fired both when the
  // client disconnects (an explicit "Abbrechen" aborts the underlying
  // fetch) and when we close the stream ourselves once the turn is done —
  // the latter is a no-op abort, nothing reads the signal after that point.
  const abortController = new AbortController()
  stream.onClosed(() => abortController.abort())

  runChatTurn(db, user.id, id, input, model, async (turnEvent) => {
    await stream.push({ event: sseEventName(turnEvent), data: JSON.stringify(sseEventData(turnEvent)) })
  }, abortController.signal)
    .catch(() => {
      // runChatTurn reports its own failures as an `error` event and never
      // rejects — this only guards against a truly unexpected throw.
    })
    .finally(() => {
      releaseTurnLock(user.id)
      return stream.close()
    })

  return stream.send()
})
