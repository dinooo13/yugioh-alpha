import { describe, expect, it } from 'vitest'
import { cardCategoryRank, compareDeckRows } from '~~/shared/deck-order'

// The deck-list order, shared by the server and the deck editor's optimistic rows (#148).
describe('compareDeckRows', () => {
  const magician = { type: 'Normal Monster', name: 'Dark Magician', nameDe: 'Dunkler Magier' }
  const pot = { type: 'Spell Card', name: 'Pot of Greed', nameDe: 'Topf der Gier' }
  const force = { type: 'Trap Card', name: 'Mirror Force', nameDe: 'Spiegelkraft' }
  const blueEyes = { type: 'Normal Monster', name: 'Blue-Eyes White Dragon', nameDe: 'Blauäugiger w. Drache' }

  it('ranks monsters, spells, traps', () => {
    expect([force, pot, magician].map(card => cardCategoryRank(card.type))).toEqual([2, 1, 0])
  })

  it('sorts the Main Deck by category, then by name in the card language', () => {
    const sorted = (locale: 'en' | 'de') => [force, pot, magician, blueEyes].sort((a, b) => compareDeckRows('main', a, b, locale)).map(card => card.name)
    expect(sorted('en')).toEqual(['Blue-Eyes White Dragon', 'Dark Magician', 'Pot of Greed', 'Mirror Force'])
    expect(sorted('de')).toEqual(['Blue-Eyes White Dragon', 'Dark Magician', 'Pot of Greed', 'Mirror Force'])
  })

  it('sorts Extra and Side by name only', () => {
    const sorted = [pot, force, magician].sort((a, b) => compareDeckRows('side', a, b, 'de')).map(card => card.nameDe)
    expect(sorted).toEqual(['Dunkler Magier', 'Spiegelkraft', 'Topf der Gier'])
  })
})
