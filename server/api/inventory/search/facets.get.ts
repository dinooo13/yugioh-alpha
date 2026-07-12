import { eq } from 'drizzle-orm'
import { useDb } from '../../../db'
import { catalogCard, catalogPrinting, catalogSet, ownedCard } from '../../../db/schema'
import { requireUser } from '../../../utils/session'

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== ''
}

function uniqueSortedStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(isNonEmptyString))).sort((a, b) => a.localeCompare(b))
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()

  const catalogRows = db
    .selectDistinct({
      type: catalogCard.type,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .where(eq(ownedCard.userId, user.id))
    .all()

  const ownershipRows = db
    .selectDistinct({
      language: ownedCard.language,
      condition: ownedCard.condition,
      edition: ownedCard.edition,
    })
    .from(ownedCard)
    .where(eq(ownedCard.userId, user.id))
    .all()

  const setRows = db
    .selectDistinct({ id: catalogSet.id, name: catalogSet.name })
    .from(ownedCard)
    .innerJoin(catalogPrinting, eq(ownedCard.printingId, catalogPrinting.id))
    .innerJoin(catalogSet, eq(catalogPrinting.setId, catalogSet.id))
    .where(eq(ownedCard.userId, user.id))
    .all()

  const setsById = new Map<string, string>()
  for (const row of setRows) {
    if (!setsById.has(row.id)) {
      setsById.set(row.id, row.name)
    }
  }
  const sets = Array.from(setsById.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const levels = Array.from(
    new Set(catalogRows.map(row => row.level).filter((level): level is number => level !== null)),
  ).sort((a, b) => a - b)

  return {
    types: uniqueSortedStrings(catalogRows.map(row => row.type)),
    attributes: uniqueSortedStrings(catalogRows.map(row => row.attribute)),
    races: uniqueSortedStrings(catalogRows.map(row => row.race)),
    levels,
    sets,
    languages: uniqueSortedStrings(ownershipRows.map(row => row.language)),
    conditions: uniqueSortedStrings(ownershipRows.map(row => row.condition)),
    editions: uniqueSortedStrings(ownershipRows.map(row => row.edition)),
  }
})
