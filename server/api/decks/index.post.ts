import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { createDeck, validateDeckCreateCardsInput, validateDeckInput } from '../../utils/decks'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const input = validateDeckInput(body)
  const cards = validateDeckCreateCardsInput(body)
  const detail = createDeck(useDb(), user.id, input, cards)

  setResponseStatus(event, 201)
  return detail
})
