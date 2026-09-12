import { createError, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../db'
import { requireProfileByHandle, toPublicProfile } from '../../../utils/profiles'
import { getOptionalUser } from '../../../utils/session'
import { requireViewableInventory } from '../../../utils/sharing'
import { inventoryCardCount, listVisibleCollections, listVisibleDecks } from '../../../utils/shared-views'
import { canViewWishlist, wishlistItemCount } from '../../../utils/wishlist'
import type { PublicProfileResponse } from '../../../../shared/sharing'

export default defineEventHandler(async (event): Promise<PublicProfileResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const handleParam = getRouterParam(event, 'handle')
  if (!handleParam) {
    throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  }

  const db = useDb()
  const profile = requireProfileByHandle(db, handleParam)
  const viewer = await getOptionalUser(event)

  // The profile page never carries an inventory token: visibility here is
  // driven only by owner / public / grant.
  let inventoryVisible: boolean
  try {
    requireViewableInventory(db, viewer?.id ?? null, profile.userId, {})
    inventoryVisible = true
  }
  catch {
    inventoryVisible = false
  }

  const isOwner = viewer?.id === profile.userId
  const wishlistVisible = canViewWishlist(profile.userId, profile.wishlistVisibility, viewer?.id ?? null)

  return {
    profile: toPublicProfile(profile),
    viewer: { isAuthenticated: viewer != null, isOwner },
    decks: listVisibleDecks(db, profile.userId, viewer?.id ?? null),
    collections: listVisibleCollections(db, profile.userId, viewer?.id ?? null),
    inventory: {
      visible: inventoryVisible,
      cardCount: inventoryVisible ? inventoryCardCount(db, profile.userId) : 0,
    },
    wishlist: {
      visible: wishlistVisible,
      itemCount: wishlistVisible ? wishlistItemCount(db, profile.userId) : 0,
    },
  }
})
