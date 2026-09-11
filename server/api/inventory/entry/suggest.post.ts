import { readBody } from 'h3'
import { useDb } from '../../../db'
import { parseSuggestRequest, suggestForRequest } from '../../../utils/card-entry'
import { requireUser } from '../../../utils/session'

/**
 * Ranks catalog candidates for freely typed, dictated, or OCR'd card lines.
 * One typed line is one result; one photo (`ocrText`) is at most one result,
 * since a single image shows a single card. Read-only: nothing is written
 * until the review flow posts to `/api/inventory/bulk`.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const request = parseSuggestRequest(await readBody(event))

  return { results: suggestForRequest(useDb(), request) }
})
