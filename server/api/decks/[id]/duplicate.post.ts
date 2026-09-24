import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { duplicateDeck, validateDuplicateDeckInput } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const input = validateDuplicateDeckInput(await readBody(event).catch(() => undefined))
  const detail = duplicateDeck(useDb(), user.id, id, input)

  setResponseStatus(event, 201)
  return detail
})
