import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { hydrateActionViews } from '../../../../../utils/assistant-chat'
import { rejectAction, refreshPackagePreviews } from '../../../../../utils/assistant-tools'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Action not found', data: { code: 'action_not_found' } })
  }

  const user = await requireUser(event)
  const db = useDb()
  const action = rejectAction(db, user.id, id)

  // The other pending proposals of its package, previewed anew on the deck as it is now (ADR 0026).
  const related = refreshPackagePreviews(db, user.id, action)

  // Hydrated (#69): the display names come along as an additive field.
  return { action: hydrateActionViews(db, user.id, [action])[0]!, related: hydrateActionViews(db, user.id, related) }
})
