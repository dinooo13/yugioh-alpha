import { readBody } from 'h3'
import { useDb } from '../../db'
import { toOwnProfile, updateProfile, validateProfileUpdateInput } from '../../utils/profiles'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const input = validateProfileUpdateInput(await readBody(event))
  const profile = updateProfile(useDb(), authUser.id, input)

  return toOwnProfile(profile)
})
