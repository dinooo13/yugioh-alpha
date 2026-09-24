import { createError, getRequestHeader, getRouterParam, readBody } from 'h3'
import { createUIMessageStreamResponse } from 'ai'
import { useDb } from '../../../../db'
import { requireOwnConversation } from '../../../../utils/assistant-chat'
import { useAssistantLanguageModel } from '../../../../utils/assistant-model'
import { startAssistantTurn } from '../../../../utils/assistant-turn'
import { validateAssistantTurnRequest } from '../../../../utils/assistant-ui-messages'
import { claimTurnLock, isTurnInFlight, releaseTurnLock } from '../../../../utils/assistant-turn-lock'
import { requireUser } from '../../../../utils/session'
import { resolveCardLocale, resolveUiLocale } from '../../../../utils/ui-locale'
import { ASSISTANT_MESSAGE_TOTAL_BYTES_MAX } from '../../../../../shared/assistant-chat'

// A little over the encoded-image cap plus the rest of the JSON body — enough
// for any legitimate request, tight enough to reject an oversized body via
// `content-length` before `readBody` buffers it into memory.
const MAX_REQUEST_BODY_BYTES = ASSISTANT_MESSAGE_TOTAL_BYTES_MAX + 8192

/**
 * One chat turn, streamed with the AI SDK's UI message stream protocol
 * (docs/adr/0020-assistant-on-the-ai-sdk.md). The body is what the AI SDK's
 * chat transport sends — only the newest message plus `trigger`; the history
 * comes from the database. Errors before the stream opens are HTTP errors
 * with `data.code` (404, 503, 409, 413, 400); errors during the turn arrive
 * as the stream's `error` chunk carrying the code.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
  }

  const user = await requireUser(event)
  const db = useDb()
  requireOwnConversation(db, user.id, id)

  const model = useAssistantLanguageModel()
  if (!model) {
    throw createError({ statusCode: 503, statusMessage: 'The assistant is not configured', data: { code: 'assistant_not_configured' } })
  }

  // Per turn, so switching either language mid-conversation takes effect
  // right away (ADR 0014/0015). Resolved before the lock, so it can't leak it.
  const locale = await resolveUiLocale(event)
  const cardLocale = await resolveCardLocale(event)

  // Claimed right after the check, before `readBody`: two near-simultaneous
  // submits must not both start a turn. Every exit path releases it once.
  if (isTurnInFlight(user.id)) {
    throw createError({ statusCode: 409, statusMessage: 'A turn is already in progress', data: { code: 'turn_in_progress' } })
  }
  claimTurnLock(user.id)
  let released = false
  const release = () => {
    if (!released) {
      released = true
      releaseTurnLock(user.id)
    }
  }

  try {
    const contentLength = Number(getRequestHeader(event, 'content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Request too large', data: { code: 'request_too_large' } })
    }
    const request = validateAssistantTurnRequest(await readBody(event))

    // A disconnect before the answer is complete means "Abbrechen": the turn
    // stops and saves what it has. `close` also fires after a normal end,
    // when `writableFinished` is already true.
    const controller = new AbortController()
    const turn = startAssistantTurn({
      db,
      userId: user.id,
      conversationId: id,
      request,
      model,
      locale,
      cardLocale,
      signal: controller.signal,
      onSettled: release,
    })
    event.node.res.on('close', () => {
      if (!event.node.res.writableFinished) {
        controller.abort()
      }
      // Normally released once the answer is persisted; this only covers a
      // response nobody reads to the end.
      void turn.done.then(release)
    })
    return createUIMessageStreamResponse({ stream: turn.stream })
  }
  catch (error) {
    release()
    throw error
  }
})
