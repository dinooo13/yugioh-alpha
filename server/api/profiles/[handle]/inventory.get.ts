import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../db'
import { getProfileByHandle, toPublicProfile } from '../../../utils/profiles'
import { getOptionalUser } from '../../../utils/session'
import { requireViewableInventory } from '../../../utils/sharing'
import { listSharedInventory, parseSharedCardListQuery } from '../../../utils/shared-views'
import type { SharedCardListResponse } from '../../../../shared/sharing'

export default defineEventHandler(async (event): Promise<SharedCardListResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const handleParam = getRouterParam(event, 'handle')
  if (!handleParam) {
    throw createError({ statusCode: 404, statusMessage: 'Inventory not found' })
  }

  const db = useDb()
  const profile = getProfileByHandle(db, handleParam)
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Inventory not found' })
  }

  const viewer = await getOptionalUser(event)
  const query = getQuery(event)
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token
  const token = typeof rawToken === 'string' ? rawToken : undefined

  const { access } = requireViewableInventory(db, viewer?.id ?? null, profile.userId, { token })

  const page = listSharedInventory(db, profile.userId, parseSharedCardListQuery(query))

  return {
    owner: toPublicProfile(profile),
    source: { kind: 'inventory', id: null, name: 'Alle Karten' },
    items: page.items,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    isOwner: access.isOwner,
  }
})
