import { readBody } from 'h3'
import { useDb } from '../../../db'
import { parseSuggestRequest, suggestForRequest } from '../../../utils/card-entry'
import { requireUser } from '../../../utils/session'

/**
 * Ranks catalog candidates for freely typed card lines (one typed line is
 * one result). Read-only: nothing is written until the review flow posts to
 * `/api/inventory/bulk`. Photo card recognition moved to the chat
 * assistant (`/assistent`, see docs/adr/0010-chat-assistant-with-tools.md).
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const request = parseSuggestRequest(await readBody(event))

  return { results: suggestForRequest(useDb(), request) }
})
