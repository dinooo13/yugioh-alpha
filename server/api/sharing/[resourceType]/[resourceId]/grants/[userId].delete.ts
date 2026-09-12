import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { removeShareGrant, resolveResourceId, validateShareResourceType } from '../../../../../utils/sharing'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const resourceType = validateShareResourceType(getRouterParam(event, 'resourceType'))

  const rawResourceId = getRouterParam(event, 'resourceId')
  const grantedUserId = getRouterParam(event, 'userId')
  if (!rawResourceId || !grantedUserId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const resourceId = resolveResourceId(resourceType, rawResourceId, authUser.id)

  return removeShareGrant(useDb(), authUser.id, resourceType, resourceId, grantedUserId)
})
