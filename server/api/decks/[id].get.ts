import { createError, getRouterParam } from 'h3'
import { useDb } from '../../db'
import { getDeckDetail, inCardLocale } from '../../utils/decks'
import { requireUser } from '../../utils/session'
import { resolveCardLocale } from '../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)

  return inCardLocale(getDeckDetail(useDb(), user.id, id), await resolveCardLocale(event))
})
