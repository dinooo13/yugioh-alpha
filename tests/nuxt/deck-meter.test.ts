import { describe, expect, it } from 'vitest'
import { deckCountState, deckMeterFill } from '~/utils/deck-meter'

describe('deckCountState', () => {
  it('rates the Main Deck against its minimum and maximum', () => {
    expect(deckCountState('main', 0)).toBe('under')
    expect(deckCountState('main', 39)).toBe('under')
    expect(deckCountState('main', 40)).toBe('ok')
    expect(deckCountState('main', 60)).toBe('ok')
    expect(deckCountState('main', 61)).toBe('over')
  })

  it('only flags an oversized Extra or Side Deck', () => {
    expect(deckCountState('extra', 0)).toBe('none')
    expect(deckCountState('extra', 15)).toBe('none')
    expect(deckCountState('extra', 16)).toBe('over')
    expect(deckCountState('side', 16)).toBe('over')
  })

  it('uses the given limits', () => {
    const limits = { mainMin: 20, mainMax: 20, extraMax: 5, sideMax: 0 }
    expect(deckCountState('main', 20, limits)).toBe('ok')
    expect(deckCountState('extra', 6, limits)).toBe('over')
    expect(deckCountState('side', 1, limits)).toBe('over')
  })
})

describe('deckMeterFill', () => {
  it('fills the Main Deck meter up to its minimum', () => {
    expect(deckMeterFill('main', 0)).toBe(0)
    expect(deckMeterFill('main', 20)).toBe(50)
    expect(deckMeterFill('main', 40)).toBe(100)
    expect(deckMeterFill('main', 55)).toBe(100)
  })

  it('fills the Extra and Side Deck meters up to their maximum', () => {
    expect(deckMeterFill('extra', 12)).toBe(80)
    expect(deckMeterFill('side', 20)).toBe(100)
  })

  it('handles a zero limit', () => {
    const limits = { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 0 }
    expect(deckMeterFill('side', 0, limits)).toBe(0)
    expect(deckMeterFill('side', 2, limits)).toBe(100)
  })
})
