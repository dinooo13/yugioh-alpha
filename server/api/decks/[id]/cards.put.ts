import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../db'
import { upsertDeckCard, validateDeckCardInput } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const input = validateDeckCardInput(await readBody(event))

  return upsertDeckCard(useDb(), user.id, id, input)
})
