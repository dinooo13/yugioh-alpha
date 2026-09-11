import { getQuery } from 'h3'
import { useDb } from '../../db'
import { ownedQuantitiesByCard } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

// Guards against an unbounded `IN (...)` list; the deckbuilder asks for one
// result page at a time.
const MAX_IDS = 100

/**
 * `GET /api/inventory/owned-quantities?ids=1,2,3` → `{ "1": 4, "2": 0, ... }`
 *
 * Owned totals for a known set of catalog cards, so views that list catalog
 * cards (the deckbuilder's "Auch Katalogkarten anzeigen" mode) can show how
 * many copies the user actually owns. Every requested id is present in the
 * response, with 0 for cards the user does not own.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const rawIds = getQuery(event).ids

  const ids = (Array.isArray(rawIds) ? rawIds : [rawIds])
    .flatMap(value => String(value ?? '').split(','))
    .map(value => Number(value.trim()))
    .filter(value => Number.isSafeInteger(value) && value > 0)
    .slice(0, MAX_IDS)

  const owned = ownedQuantitiesByCard(useDb(), user.id, ids)

  return Object.fromEntries(ids.map(id => [id, owned.get(id) ?? 0]))
})
