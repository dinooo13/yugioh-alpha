import { useDb } from '../../../db'
import { getCatalogCardDetail } from '../../../utils/catalog-search'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const id = Number.parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Card not found' })
  }

  const detail = await getCatalogCardDetail(useDb(), id)
  if (!detail) {
    throw createError({ statusCode: 404, statusMessage: 'Card not found' })
  }

  return detail
})
