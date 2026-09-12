import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../../db'
import { getProfileByHandle, toPublicProfile } from '../../../../utils/profiles'
import { getOptionalUser } from '../../../../utils/session'
import { requireViewableDeck } from '../../../../utils/sharing'
import { buildSharedDeckView } from '../../../../utils/shared-views'
import type { SharedDeckView } from '../../../../../shared/sharing'

export default defineEventHandler(async (event): Promise<SharedDeckView> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const handleParam = getRouterParam(event, 'handle')
  const deckId = getRouterParam(event, 'deckId')
  if (!handleParam || !deckId) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const db = useDb()
  // Any failure — unknown handle, unknown deck, deck of a different owner,
  // no access, wrong token — reports the same 404 (ADR 0004 boundary).
  const profile = getProfileByHandle(db, handleParam)
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const viewer = await getOptionalUser(event)

  const query = getQuery(event)
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token
  const token = typeof rawToken === 'string' ? rawToken : undefined

  const { row, access } = requireViewableDeck(db, viewer?.id ?? null, deckId, {
    token,
    expectedOwnerUserId: profile.userId,
  })

  return buildSharedDeckView(db, row, toPublicProfile(profile), access.isOwner)
})
