import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { duplicateDeck, inCardLocale, validateDuplicateDeckInput } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'
import { resolveCardLocale } from '../../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const input = validateDuplicateDeckInput(await readBody(event).catch(() => undefined))
  const detail = duplicateDeck(useDb(), user.id, id, input)

  setResponseStatus(event, 201)
  return inCardLocale(detail, await resolveCardLocale(event))
})
