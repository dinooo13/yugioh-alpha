import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../../db'
import { getProfileByHandle, toPublicProfile } from '../../../../utils/profiles'
import { getOptionalUser } from '../../../../utils/session'
import { resolveCardLocale } from '../../../../utils/ui-locale'
import { requireViewableCollection } from '../../../../utils/sharing'
import { listSharedCollection, parseSharedCardListQuery } from '../../../../utils/shared-views'
import type { SharedCollectionResponse } from '../../../../../shared/sharing'

export default defineEventHandler(async (event): Promise<SharedCollectionResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const handleParam = getRouterParam(event, 'handle')
  const collectionId = getRouterParam(event, 'collectionId')
  if (!handleParam || !collectionId) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  const db = useDb()
  // Any failure — unknown handle, unknown collection, foreign owner, no
  // access, wrong token — reports the same 404 (ADR 0004 boundary).
  const profile = getProfileByHandle(db, handleParam)
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  const viewer = await getOptionalUser(event)
  const query = getQuery(event)
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token
  const token = typeof rawToken === 'string' ? rawToken : undefined

  const { row, access } = requireViewableCollection(db, viewer?.id ?? null, collectionId, {
    token,
    expectedOwnerUserId: profile.userId,
  })

  const page = listSharedCollection(db, profile.userId, row.id, {
    ...parseSharedCardListQuery(query),
    cardLocale: await resolveCardLocale(event),
  })

  return {
    owner: toPublicProfile(profile),
    source: { kind: 'collection', id: row.id, name: row.name },
    items: page.items,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    isOwner: access.isOwner,
  }
})
