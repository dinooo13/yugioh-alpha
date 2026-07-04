import { asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, catalogPrinting, catalogSet } from '../db/schema'
import { buildCardListWhere, type CardListQuery } from './catalog-query'

type Db = ReturnType<typeof useDb>

export interface CatalogCardSummary {
  id: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
}

export async function searchCatalogCards(db: Db, filters: CardListQuery) {
  const where = buildCardListWhere(filters)
  const offset = (filters.page - 1) * filters.pageSize
  const orderBy = filters.sort === '-name'
    ? [desc(catalogCard.name)]
    : filters.sort === 'newest'
      ? [sql`${catalogCard.tcgDate} is null`, desc(catalogCard.tcgDate), asc(catalogCard.name)]
      : [asc(catalogCard.name)]

  const totalRows = await db
    .select({ total: count() })
    .from(catalogCard)
    .where(where)

  const cards = await db
    .select({
      id: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
    })
    .from(catalogCard)
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset)

  const ids = cards.map(card => card.id)
  const imageRows = ids.length > 0
    ? await db
        .select({
          cardId: catalogCardImage.cardId,
          imageSmall: catalogCardImage.imageUrlSmall,
        })
        .from(catalogCardImage)
        .where(inArray(catalogCardImage.cardId, ids))
        .orderBy(asc(catalogCardImage.cardId), asc(catalogCardImage.id))
    : []

  const primaryImages = new Map<number, string | null>()
  for (const image of imageRows) {
    if (!primaryImages.has(image.cardId)) {
      primaryImages.set(image.cardId, image.imageSmall)
    }
  }

  const items: CatalogCardSummary[] = cards.map(card => ({
    ...card,
    imageSmall: primaryImages.get(card.id) ?? null,
  }))

  return {
    items,
    total: totalRows[0]?.total ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function getCatalogCardDetail(db: Db, id: number) {
  const card = await db.query.catalogCard.findFirst({
    where: eq(catalogCard.id, id),
  })

  if (!card) {
    return null
  }

  const printings = await db
    .select({
      setCode: catalogPrinting.setCode,
      setName: catalogSet.name,
      rarity: catalogPrinting.rarity,
      price: catalogPrinting.price,
    })
    .from(catalogPrinting)
    .innerJoin(catalogSet, eq(catalogPrinting.setId, catalogSet.id))
    .where(eq(catalogPrinting.cardId, id))
    .orderBy(asc(catalogSet.name), asc(catalogPrinting.setCode))

  const images = await db
    .select({
      id: catalogCardImage.id,
      imageUrl: catalogCardImage.imageUrl,
      imageUrlSmall: catalogCardImage.imageUrlSmall,
      imageUrlCropped: catalogCardImage.imageUrlCropped,
    })
    .from(catalogCardImage)
    .where(eq(catalogCardImage.cardId, id))
    .orderBy(asc(catalogCardImage.id))

  return { card, printings, images }
}

export async function getCatalogFacets(db: Db) {
  const [types, attributes, races, levels, sets] = await Promise.all([
    db
      .selectDistinct({ value: catalogCard.type })
      .from(catalogCard)
      .orderBy(asc(catalogCard.type)),
    db
      .selectDistinct({ value: catalogCard.attribute })
      .from(catalogCard)
      .where(isNotNull(catalogCard.attribute))
      .orderBy(asc(catalogCard.attribute)),
    db
      .selectDistinct({ value: catalogCard.race })
      .from(catalogCard)
      .where(isNotNull(catalogCard.race))
      .orderBy(asc(catalogCard.race)),
    db
      .selectDistinct({ value: catalogCard.level })
      .from(catalogCard)
      .where(isNotNull(catalogCard.level))
      .orderBy(asc(catalogCard.level)),
    db
      .select({ id: catalogSet.id, name: catalogSet.name })
      .from(catalogSet)
      .orderBy(asc(catalogSet.name)),
  ])

  return {
    types: types.map(item => item.value),
    attributes: attributes.flatMap(item => item.value ? [item.value] : []),
    races: races.flatMap(item => item.value ? [item.value] : []),
    levels: levels.flatMap(item => item.value === null ? [] : [item.value]),
    sets,
  }
}
