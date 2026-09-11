import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { duplicateDeck } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const detail = duplicateDeck(useDb(), user.id, id)

  setResponseStatus(event, 201)
  return detail
})
