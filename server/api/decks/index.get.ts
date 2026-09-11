import { getQuery } from 'h3'
import { useDb } from '../../db'
import { listDecks, parseDeckListQuery } from '../../utils/decks'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return listDecks(useDb(), user.id, parseDeckListQuery(getQuery(event)))
})
