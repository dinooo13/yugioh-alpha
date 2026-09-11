import { useDb } from '../../db'
import { listRuleFormats } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return listRuleFormats(useDb(), user.id)
})
