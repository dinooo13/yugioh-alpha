import { createError, getQuery, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { validateDeckWithRules } from '../../../utils/decks'
import { requireAccessibleFormat } from '../../../utils/rule-formats'
import { requireUser } from '../../../utils/session'
import { deck } from '../../../db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Validates one of the caller's decks against any format they can see —
 * either an explicit `formatId` (preview before assigning it) or the format
 * the deck already carries.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const db = useDb()

  const deckRow = db
    .select({ id: deck.id, formatId: deck.formatId })
    .from(deck)
    .where(and(eq(deck.id, id), eq(deck.userId, user.id)))
    .get()

  if (!deckRow) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const query = getQuery(event)
  const rawFormatId = query.formatId ?? query.format_id
  const formatId = typeof rawFormatId === 'string' && rawFormatId !== '' ? rawFormatId : deckRow.formatId

  if (!formatId) {
    throw createError({ statusCode: 400, statusMessage: 'format_id is required for a deck without a format' })
  }

  const format = requireAccessibleFormat(db, user.id, formatId)

  return {
    format: { id: format.id, name: format.name, isBuiltin: format.isBuiltin },
    validation: validateDeckWithRules(db, user.id, id, format.rules),
  }
})
