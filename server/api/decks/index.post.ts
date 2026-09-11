import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { createDeck, validateDeckInput } from '../../utils/decks'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateDeckInput(await readBody(event))
  const detail = createDeck(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return detail
})
