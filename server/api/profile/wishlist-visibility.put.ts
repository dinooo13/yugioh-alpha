import { readBody } from 'h3'
import { useDb } from '../../db'
import { toOwnProfile, updateWishlistVisibility, validateWishlistVisibility } from '../../utils/profiles'
import { requireUser } from '../../utils/session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const body = await readBody(event)
  const visibility = validateWishlistVisibility(isRecord(body) ? body.visibility : undefined)

  const profile = updateWishlistVisibility(useDb(), authUser.id, visibility)

  return toOwnProfile(profile)
})
