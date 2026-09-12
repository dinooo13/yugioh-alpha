import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { swapPairing, validatePairingSwapInput } from '../../../../utils/tournaments'
import { requireUser } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const input = validatePairingSwapInput(await readBody(event))

  return swapPairing(useDb(), user.id, id, input)
})
