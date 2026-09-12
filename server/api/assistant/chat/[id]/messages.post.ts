import { and, eq } from 'drizzle-orm'
import { createError, createEventStream, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { assistantConversation } from '../../../../db/schema'
import { useDeckAssistantModel } from '../../../../utils/deck-assistant-model'
import { runChatTurn, validateAssistantMessageInput } from '../../../../utils/assistant-chat'
import type { ChatTurnEvent } from '../../../../utils/assistant-chat'
import { requireUser } from '../../../../utils/session'

// One running turn per user at a time — a double-click or duplicate submit
// must not start two model calls/DB write passes concurrently. Module-level,
// in-memory, process-local: the same guard shape as POST /api/assistant/suggest.
const usersInFlight = new Set<string>()

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

  if (usersInFlight.has(user.id)) {
    throw createError({ statusCode: 409, statusMessage: 'Es läuft bereits eine Anfrage.' })
  }

  const input = validateAssistantMessageInput(await readBody(event))
  const stream = createEventStream(event)

  usersInFlight.add(user.id)
  runChatTurn(db, user.id, id, input, model, async (turnEvent) => {
    await stream.push({ event: sseEventName(turnEvent), data: JSON.stringify(sseEventData(turnEvent)) })
  })
    .catch(() => {
      // runChatTurn reports its own failures as an `error` event and never
      // rejects — this only guards against a truly unexpected throw.
    })
    .finally(() => {
      usersInFlight.delete(user.id)
      return stream.close()
    })

  return stream.send()
})
