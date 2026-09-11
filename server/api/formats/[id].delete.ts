import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { deleteRuleFormat } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Format not found' })
  }

  const user = await requireUser(event)
  deleteRuleFormat(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
