import { getQuery } from 'h3'
import { useDb } from '../../db'
import { listWishlist } from '../../utils/wishlist'
import { requireUser } from '../../utils/session'
import { resolveCardLocale } from '../../utils/ui-locale'

function parseListQuery(rawQuery: Record<string, unknown>) {
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value)
  const rawQ = first(rawQuery.q)
  const page = Number(first(rawQuery.page))
  const pageSize = Number(first(rawQuery.pageSize))

  return {
    q: typeof rawQ === 'string' && rawQ.trim() !== '' ? rawQ.trim() : undefined,
    page: Number.isInteger(page) && page > 0 ? page : undefined,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : undefined,
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return listWishlist(useDb(), user.id, {
    ...parseListQuery(getQuery(event)),
    cardLocale: await resolveCardLocale(event),
  })
})
