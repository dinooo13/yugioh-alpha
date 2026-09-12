import { createError, getRouterParam, readBody, setHeader, setResponseStatus } from 'h3'
import { useDb } from '../../../../db'
import { addShareGrant, resolveResourceId, validateShareResourceType } from '../../../../utils/sharing'
import { requireUser } from '../../../../utils/session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const resourceType = validateShareResourceType(getRouterParam(event, 'resourceType'))

  const rawResourceId = getRouterParam(event, 'resourceId')
  if (!rawResourceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const resourceId = resolveResourceId(resourceType, rawResourceId, authUser.id)

  const body = await readBody(event)
  const grantedUserId = isRecord(body) && typeof body.userId === 'string' ? body.userId : undefined
  if (!grantedUserId) {
    throw createError({ statusCode: 400, statusMessage: 'userId is required' })
  }

  const state = addShareGrant(useDb(), authUser.id, resourceType, resourceId, grantedUserId)

  setResponseStatus(event, 201)
  return state
})
