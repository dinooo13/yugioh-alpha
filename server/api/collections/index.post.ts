import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { createCollection, validateCollectionInput } from '../../utils/collections'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateCollectionInput(await readBody(event))
  const row = await createCollection(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return row
})
