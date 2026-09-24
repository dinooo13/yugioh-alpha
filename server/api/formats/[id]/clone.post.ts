import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { cloneRuleFormat, validateRuleFormatUpdateInput } from '../../../utils/rule-formats'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Format not found' })
  }

  const user = await requireUser(event)
  // Optional overrides (name, description, rules) — see cloneRuleFormat.
  const body = await readBody(event).catch(() => undefined)
  const overrides = body === undefined || body === null || body === '' ? {} : validateRuleFormatUpdateInput(body)
  const format = cloneRuleFormat(useDb(), user.id, id, overrides)

  setResponseStatus(event, 201)
  return format
})
