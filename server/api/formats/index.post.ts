import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { createRuleFormat, validateRuleFormatInput } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateRuleFormatInput(await readBody(event))
  const format = createRuleFormat(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return format
})
