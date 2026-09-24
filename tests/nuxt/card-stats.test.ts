import { describe, expect, it } from 'vitest'
import { formatCardStat } from '~~/shared/card-stats'

describe('formatCardStat', () => {
  it.each([
    [2500, '2500'],
    [0, '0'],
    [-1, '?'],
    [null, '–'],
    [undefined, '–'],
  ])('%s → %s', (value, expected) => {
    expect(formatCardStat(value)).toBe(expected)
  })
})
