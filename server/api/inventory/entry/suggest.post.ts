import { readBody } from 'h3'
import { useDb } from '../../../db'
import { parseSuggestInput, parseSuggestLimit, suggestEntryMatches } from '../../../utils/card-entry'
import { requireUser } from '../../../utils/session'

/**
 * Ranks catalog candidates for freely typed, dictated, or OCR'd card lines.
 * Read-only: nothing is written until the review flow posts to
 * `/api/inventory/bulk`.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const body = await readBody(event)
  const lines = parseSuggestInput(body)
  const limit = parseSuggestLimit(body)

  return { results: suggestEntryMatches(useDb(), lines, limit) }
})
