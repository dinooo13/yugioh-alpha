import { useDb } from '../../db'
import { listCollections } from '../../utils/collections'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return listCollections(useDb(), user.id)
})
