import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { addOwnedCard, validateInventoryInput } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateInventoryInput(await readBody(event))
  const row = await addOwnedCard(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return row
})
