import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { createTournament, validateTournamentInput } from '../../utils/tournaments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateTournamentInput(await readBody(event))
  const detail = createTournament(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return detail
})
