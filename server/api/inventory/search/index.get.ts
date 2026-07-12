import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { getQuery } from 'h3'
import { useDb } from '../../../db'
import { catalogCard, catalogCardImage, collection, ownedCard } from '../../../db/schema'
import { assertCollectionOwnedByUser } from '../../../utils/collections'
import {
  buildInventorySearchWhere,
  parseInventorySearchQuery,
  UNASSIGNED_COLLECTION_ID,
} from '../../../utils/inventory-search'
import type { InventorySearchSort } from '../../../utils/inventory-search'
import { requireUser } from '../../../utils/session'

const totalQuantitySql = sql<number>`sum(${ownedCard.quantity})`

function buildOrderBy(sort: InventorySearchSort): SQL[] {
  switch (sort) {
    case '-name':
      return [desc(catalogCard.name)]
    case 'quantity':
      return [desc(totalQuantitySql), asc(catalogCard.name)]
    case 'newest':
      return [desc(catalogCard.tcgDate)]
    case 'name':
    default:
      return [asc(catalogCard.name)]
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  const filters = parseInventorySearchQuery(getQuery(event))

  if (filters.collectionId && filters.collectionId !== UNASSIGNED_COLLECTION_ID) {
    assertCollectionOwnedByUser(db, user.id, filters.collectionId)
  }

  const where = buildInventorySearchWhere(user.id, filters)

  const pageRows = db
    .select({
      catalogCardId: ownedCard.catalogCardId,
      totalQuantity: totalQuantitySql,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .where(where)
    .groupBy(ownedCard.catalogCardId)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize)
    .all()

  const total = db
    .select({ count: sql<number>`count(distinct ${ownedCard.catalogCardId})` })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .where(where)
    .get()?.count ?? 0

  const catalogCardIds = pageRows.map(row => row.catalogCardId)

  if (catalogCardIds.length === 0) {
    return { items: [], total, page: filters.page, pageSize: filters.pageSize }
  }

  // Breakdown reuses the full search `where` (not just a user/id scope) so a
  // per-collection quantity always sums to the same total as query 1 — the
  // `collectionId` gate (when present) is an EXISTS check that doesn't
  // itself exclude rows from other collections, by design (see
  // buildInventorySearchWhere's doc comment).
  const breakdownRows = db
    .select({
      catalogCardId: ownedCard.catalogCardId,
      collectionId: ownedCard.collectionId,
      collectionName: collection.name,
      quantity: sql<number>`sum(${ownedCard.quantity})`,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(ownedCard.catalogCardId, catalogCard.id))
    .leftJoin(collection, eq(ownedCard.collectionId, collection.id))
    .where(and(where, inArray(ownedCard.catalogCardId, catalogCardIds)))
    .groupBy(ownedCard.catalogCardId, ownedCard.collectionId)
    .all()

  const displayRows = db
    .select({
      catalogCardId: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      imageSmall: sql<string | null>`min(${catalogCardImage.imageUrlSmall})`,
    })
    .from(catalogCard)
    .leftJoin(catalogCardImage, eq(catalogCardImage.cardId, catalogCard.id))
    .where(inArray(catalogCard.id, catalogCardIds))
    .groupBy(catalogCard.id)
    .all()

  const displayByCardId = new Map(displayRows.map(row => [row.catalogCardId, row]))

  const breakdownByCardId = new Map<
    number,
    Array<{ collectionId: string | null, collectionName: string | null, quantity: number }>
  >()
  for (const row of breakdownRows) {
    const list = breakdownByCardId.get(row.catalogCardId) ?? []
    list.push({ collectionId: row.collectionId, collectionName: row.collectionName, quantity: row.quantity })
    breakdownByCardId.set(row.catalogCardId, list)
  }

  const items = pageRows.map((row) => {
    const display = displayByCardId.get(row.catalogCardId)
    return {
      catalogCardId: row.catalogCardId,
      name: display?.name ?? '',
      type: display?.type ?? '',
      attribute: display?.attribute ?? null,
      race: display?.race ?? null,
      level: display?.level ?? null,
      atk: display?.atk ?? null,
      def: display?.def ?? null,
      imageSmall: display?.imageSmall ?? null,
      totalQuantity: row.totalQuantity,
      collectionBreakdown: breakdownByCardId.get(row.catalogCardId) ?? [],
    }
  })

  return { items, total, page: filters.page, pageSize: filters.pageSize }
})
