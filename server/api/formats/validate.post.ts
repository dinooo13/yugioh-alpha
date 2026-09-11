import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { validateDeckWithRules } from '../../utils/decks'
import { normalizeRuleSet } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

/**
 * Previews a *not yet saved* rule set against one of the caller's decks, so
 * the format editor can show the effect of a rule before it is stored.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)

  const deckId = body?.deckId ?? body?.deck_id
  if (typeof deckId !== 'string' || deckId === '') {
    throw createError({ statusCode: 400, statusMessage: 'deck_id is required' })
  }

  const rules = normalizeRuleSet(body?.rules ?? { rules: [] })

  return { validation: validateDeckWithRules(useDb(), user.id, deckId, rules) }
})
