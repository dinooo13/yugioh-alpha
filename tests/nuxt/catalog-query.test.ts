import { describe, expect, it } from 'vitest'
import { buildCardListWhere, escapeLikeTerm, parseCardListQuery } from '../../server/utils/catalog-query'

describe('parseCardListQuery', () => {
  it('clamps paging and drops invalid levels', () => {
    const parsed = parseCardListQuery({
      page: '0',
      pageSize: '999',
      level: ['abc', '8'],
    })

    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(60)
    expect(parsed.levels).toEqual([8])
  })

  it('parses CSV and repeated facet values', () => {
    const parsed = parseCardListQuery({
      type: 'Effect Monster,Spell Card',
      attribute: ['LIGHT', 'DARK'],
      race: 'Dragon',
      sort: '-name',
    })

    expect(parsed.types).toEqual(['Effect Monster', 'Spell Card'])
    expect(parsed.attributes).toEqual(['LIGHT', 'DARK'])
    expect(parsed.races).toEqual(['Dragon'])
    expect(parsed.sort).toBe('-name')
  })
})

describe('buildCardListWhere', () => {
  it('escapes LIKE wildcards before wrapping the search term', () => {
    expect(escapeLikeTerm('50%_off\\sale')).toBe('50\\%\\_off\\\\sale')

    const filters = parseCardListQuery({ q: '50%_off' })
    const condition = buildCardListWhere(filters)

    expect(condition).toBeDefined()
  })
})
