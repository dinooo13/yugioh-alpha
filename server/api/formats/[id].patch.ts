import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { updateRuleFormat, validateRuleFormatUpdateInput } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Format not found' })
  }

  const user = await requireUser(event)
  const input = validateRuleFormatUpdateInput(await readBody(event))

  return updateRuleFormat(useDb(), user.id, id, input)
})
