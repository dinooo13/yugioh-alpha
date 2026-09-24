import { createError, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { inCardLocale, removeDeckCard, validateDeckCardInput } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'
import { resolveCardLocale } from '../../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const query = getQuery(event)
  // Reuses the body validator: same fields, just taken from the query string.
  const input = validateDeckCardInput({
    catalogCardId: query.catalogCardId ?? query.catalog_card_id,
    section: query.section,
  })

  return inCardLocale(
    removeDeckCard(useDb(), user.id, id, input.catalogCardId, input.section),
    await resolveCardLocale(event),
  )
})
