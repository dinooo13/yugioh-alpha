import { useDb } from '../../db'
import { ensureProfile, toOwnProfile } from '../../utils/profiles'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const profile = ensureProfile(useDb(), authUser.id)

  return toOwnProfile(profile)
})
