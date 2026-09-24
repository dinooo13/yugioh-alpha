import { useDb } from '../../../db'
import { loadInventorySearchFacets } from '../../../utils/inventory-search'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return loadInventorySearchFacets(useDb(), user.id)
})
