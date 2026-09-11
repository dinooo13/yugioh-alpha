import { createError, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { removeDeckCard, validateDeckCardInput } from '../../../utils/decks'
import { requireUser } from '../../../utils/session'

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

  return removeDeckCard(useDb(), user.id, id, input.catalogCardId, input.section)
})
