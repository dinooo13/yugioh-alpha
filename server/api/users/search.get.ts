import { getQuery } from 'h3'
import { useDb } from '../../db'
import { searchUsers } from '../../utils/profiles'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const query = getQuery(event)
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q
  const q = typeof rawQ === 'string' ? rawQ : ''

  return { items: searchUsers(useDb(), authUser.id, q) }
})
