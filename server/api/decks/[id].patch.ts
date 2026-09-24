import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { inCardLocale, updateDeck, validateDeckUpdateInput } from '../../utils/decks'
import { requireUser } from '../../utils/session'
import { resolveCardLocale } from '../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const input = validateDeckUpdateInput(await readBody(event))

  return inCardLocale(updateDeck(useDb(), user.id, id, input), await resolveCardLocale(event))
})
