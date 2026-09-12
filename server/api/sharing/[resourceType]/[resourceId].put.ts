import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../db'
import { resolveResourceId, setShareState, validateShareResourceType, validateShareUpdateInput } from '../../../utils/sharing'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event)
  const resourceType = validateShareResourceType(getRouterParam(event, 'resourceType'))

  const rawResourceId = getRouterParam(event, 'resourceId')
  if (!rawResourceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const resourceId = resolveResourceId(resourceType, rawResourceId, authUser.id)
  const input = validateShareUpdateInput(await readBody(event))

  return setShareState(useDb(), authUser.id, resourceType, resourceId, input)
})
