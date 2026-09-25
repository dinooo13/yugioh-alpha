import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../db'
import {
  incrementDeckCard,
  inCardLocale,
  upsertDeckCard,
  validateDeckCardIncrementInput,
  validateDeckCardInput,
} from '../../../utils/decks'
import { requireUser } from '../../../utils/session'
import { resolveCardLocale } from '../../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const body = await readBody(event)

  // `{ quantity }` sets the section's copies (the deck editor);
  // `{ increment }` adds to them in one step (the catalog's "Zum Deck", #148).
  const isIncrement = Boolean(body) && typeof body === 'object' && 'increment' in body && body.increment !== undefined
  const detail = isIncrement
    ? incrementDeckCard(useDb(), user.id, id, validateDeckCardIncrementInput(body))
    : upsertDeckCard(useDb(), user.id, id, validateDeckCardInput(body))

  return inCardLocale(detail, await resolveCardLocale(event))
})
