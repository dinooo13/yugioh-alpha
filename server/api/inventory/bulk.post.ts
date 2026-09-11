import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { addOwnedCardsBulk, validateInventoryBulkInput } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

/**
 * Adds up to 200 reviewed cards at once. Every item is validated before
 * anything is written, and the batch is written in a single transaction, so
 * the "Schnellerfassung" review flow is all-or-nothing.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()

  const inputs = validateInventoryBulkInput(db, user.id, await readBody(event))
  const result = await addOwnedCardsBulk(db, user.id, inputs)

  setResponseStatus(event, 201)
  return result
})
