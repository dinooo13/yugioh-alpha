import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { deleteConversation } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Unterhaltung nicht gefunden.' })
  }

  const user = await requireUser(event)
  deleteConversation(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
