import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../db'
import { getProfileByHandle, toPublicProfile } from '../../../utils/profiles'
import { getOptionalUser } from '../../../utils/session'
import { parsePageQuery } from '../../../utils/shared-views'
import { canViewWishlist, listPublicWishlist } from '../../../utils/wishlist'
import type { SharedWishlistResponse } from '../../../../shared/sharing'

export default defineEventHandler(async (event): Promise<SharedWishlistResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const handleParam = getRouterParam(event, 'handle')
  if (!handleParam) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist not found' })
  }

  const db = useDb()
  const profile = getProfileByHandle(db, handleParam)
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist not found' })
  }

  const viewer = await getOptionalUser(event)

  if (!canViewWishlist(profile.userId, profile.wishlistVisibility, viewer?.id ?? null)) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist not found' })
  }

  const page = listPublicWishlist(db, profile.userId, parsePageQuery(getQuery(event)))

  return { ...page, owner: toPublicProfile(profile) }
})
