import { describe, expect, it } from 'vitest'
import { pluralize } from '~~/shared/plural'

describe('pluralize', () => {
  it('uses the singular form for exactly 1', () => {
    expect(pluralize(1, 'Karte', 'Karten')).toBe('1 Karte')
  })

  it('uses the plural form for 0 and for more than 1', () => {
    expect(pluralize(0, 'Karte', 'Karten')).toBe('0 Karten')
    expect(pluralize(2, 'Karte', 'Karten')).toBe('2 Karten')
    expect(pluralize(40, 'Karte', 'Karten')).toBe('40 Karten')
  })
})
