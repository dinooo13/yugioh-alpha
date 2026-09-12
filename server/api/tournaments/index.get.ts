import { getQuery } from 'h3'
import { useDb } from '../../db'
import { listTournaments, parseTournamentListQuery } from '../../utils/tournaments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return listTournaments(useDb(), user.id, parseTournamentListQuery(getQuery(event)))
})
