import { describe, expect, it } from 'vitest'
import { mapCardToRows, slugifySetName } from '../../server/utils/ygoprodeck'
import { darkMagicianFixture, potOfGreedFixture } from './fixtures/ygoprodeck-cards'

const SYNCED_AT = new Date('2026-07-04T00:00:00Z')

describe('mapCardToRows', () => {
  it('maps a monster card with stats, link markers, and images', () => {
    const mapped = mapCardToRows(darkMagicianFixture, SYNCED_AT)

    expect(mapped.card).toMatchObject({
      id: 46986414,
      name: 'Dark Magician',
      type: 'Normal Monster',
      race: 'Spellcaster',
      attribute: 'DARK',
      atk: 2500,
      def: 2100,
      level: 7,
      linkval: null,
      scale: null,
      linkMarkers: null,
      banlistInfo: { ban_tcg: 'Limited' },
      cardPrices: { cardmarket_price: '1.23' },
      tcgDate: '2002-03-08',
      ocgDate: '1999-02-04',
      syncedAt: SYNCED_AT,
    })

    expect(mapped.images).toEqual([
      {
        id: 46986414,
        cardId: 46986414,
        imageUrl: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
        imageUrlSmall: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg',
        imageUrlCropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg',
      },
    ])
  })

  it('maps a spell/trap card with nullable monster-only fields', () => {
    const mapped = mapCardToRows(potOfGreedFixture, SYNCED_AT)

    expect(mapped.card).toMatchObject({
      id: 55144522,
      name: 'Pot of Greed',
      type: 'Spell Card',
      race: 'Normal',
      attribute: null,
      atk: null,
      def: null,
      level: null,
      linkval: null,
      scale: null,
    })
  })

  it('dedupes a shared set name across two cards into one set with two printings', () => {
    const mappedDarkMagician = mapCardToRows(darkMagicianFixture, SYNCED_AT)
    const mappedPotOfGreed = mapCardToRows(potOfGreedFixture, SYNCED_AT)

    const sharedSetName = 'Legend of Blue Eyes White Dragon'
    const setsForSharedName = [...mappedDarkMagician.sets, ...mappedPotOfGreed.sets].filter(
      set => set.name === sharedSetName,
    )
    // Both cards reference the same set name, so its slugified id must match
    // even though each card only carries its own row (dedup happens at
    // upsert time in catalog-sync); here we assert the ids agree.
    expect(new Set(setsForSharedName.map(set => set.id)).size).toBe(1)

    const printingsInSharedSet = [
      ...mappedDarkMagician.printings,
      ...mappedPotOfGreed.printings,
    ].filter(printing => printing.setId === setsForSharedName[0]!.id)
    expect(printingsInSharedSet).toHaveLength(2)
    expect(printingsInSharedSet.map(p => p.setCode).sort()).toEqual(['LOB-005', 'LOB-119'])
  })
})

describe('slugifySetName', () => {
  it('produces a stable, url-safe id', () => {
    expect(slugifySetName('Legend of Blue Eyes White Dragon')).toBe(
      'legend-of-blue-eyes-white-dragon',
    )
    expect(slugifySetName('Dark Magician Structure Deck')).toBe('dark-magician-structure-deck')
  })
})
