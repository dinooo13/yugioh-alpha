import { describe, expect, it } from 'vitest'
import { deckBreakdownGroups, deckCardKind, deckKindBreakdown } from '~~/shared/deck-breakdown'

// The deck header's card-kind chips (owner feedback in #148).
describe('deckCardKind', () => {
  it('maps every frame type to its kind', () => {
    for (const frameType of ['normal', 'effect', 'ritual', 'spell', 'trap', 'fusion', 'synchro', 'xyz', 'link'] as const) {
      expect(deckCardKind({ type: 'whatever', frameType })).toBe(frameType)
    }
  })

  it('counts Pendulum monsters by their base frame', () => {
    expect(deckCardKind({ type: 'Pendulum Normal Monster', frameType: 'normal_pendulum' })).toBe('normal')
    expect(deckCardKind({ type: 'Pendulum Effect Monster', frameType: 'effect_pendulum' })).toBe('effect')
    expect(deckCardKind({ type: 'Pendulum Effect Ritual Monster', frameType: 'ritual_pendulum' })).toBe('ritual')
    expect(deckCardKind({ type: 'XYZ Pendulum Effect Monster', frameType: 'xyz_pendulum' })).toBe('xyz')
    expect(deckCardKind({ type: 'Synchro Pendulum Effect Monster', frameType: 'synchro_pendulum' })).toBe('synchro')
    expect(deckCardKind({ type: 'Pendulum Effect Fusion Monster', frameType: 'fusion_pendulum' })).toBe('fusion')
  })

  it('falls back to the type line without a frame type', () => {
    expect(deckCardKind({ type: 'Ritual Effect Monster', frameType: null })).toBe('ritual')
    expect(deckCardKind({ type: 'Flip Effect Monster', frameType: null })).toBe('effect')
    expect(deckCardKind({ type: 'Normal Tuner Monster', frameType: null })).toBe('normal')
    expect(deckCardKind({ type: 'Spell Card', frameType: null })).toBe('spell')
  })

  it('puts tokens, skills and unknown cards under "other"', () => {
    expect(deckCardKind({ type: 'Token', frameType: 'token' })).toBe('other')
    expect(deckCardKind({ type: 'Skill Card', frameType: 'skill' })).toBe('other')
    expect(deckCardKind({ type: null, frameType: null })).toBe('other')
    expect(deckCardKind({})).toBe('other')
  })
})

describe('deckKindBreakdown', () => {
  it('sums the copies per kind in the chip order and leaves out kinds without copies', () => {
    expect(deckKindBreakdown([
      { type: 'Trap Card', frameType: 'trap', quantity: 1 },
      { type: 'Spell Card', frameType: 'spell', quantity: 2 },
      { type: 'Normal Monster', frameType: 'normal', quantity: 3 },
      { type: 'Effect Monster', frameType: 'effect', quantity: 2 },
      { type: 'Pendulum Effect Monster', frameType: 'effect_pendulum', quantity: 1 },
      { type: 'Spell Card', frameType: 'spell', quantity: 1 },
      { type: 'Token', frameType: 'token', quantity: 1 },
    ])).toEqual([
      { kind: 'normal', count: 3 },
      { kind: 'effect', count: 3 },
      { kind: 'spell', count: 3 },
      { kind: 'trap', count: 1 },
      { kind: 'other', count: 1 },
    ])
  })

  it('is empty for no rows', () => {
    expect(deckKindBreakdown([])).toEqual([])
  })
})

describe('deckBreakdownGroups', () => {
  const normal = { type: 'Normal Monster', frameType: 'normal', quantity: 3 }
  const spell = { type: 'Spell Card', frameType: 'spell', quantity: 2 }
  const synchro = { type: 'Synchro Monster', frameType: 'synchro', quantity: 1 }

  it('is empty for an empty deck', () => {
    expect(deckBreakdownGroups({ main: [], extra: [] })).toEqual([])
  })

  it('lists Main, then Extra', () => {
    expect(deckBreakdownGroups({ extra: [synchro], main: [spell, normal] })).toEqual([
      { section: 'main', kinds: [{ kind: 'normal', count: 3 }, { kind: 'spell', count: 2 }] },
      { section: 'extra', kinds: [{ kind: 'synchro', count: 1 }] },
    ])
  })

  it('drops a section without copies', () => {
    expect(deckBreakdownGroups({ main: [normal], extra: [] })).toEqual([
      { section: 'main', kinds: [{ kind: 'normal', count: 3 }] },
    ])
    expect(deckBreakdownGroups({ main: [], extra: [synchro] })).toEqual([
      { section: 'extra', kinds: [{ kind: 'synchro', count: 1 }] },
    ])
  })

  it('never counts the Side Deck', () => {
    const sections = { main: [normal], extra: [], side: [{ type: 'Trap Card', frameType: 'trap', quantity: 2 }] }
    expect(deckBreakdownGroups(sections)).toEqual([
      { section: 'main', kinds: [{ kind: 'normal', count: 3 }] },
    ])
  })

  it('counts rows without card data as "other"', () => {
    expect(deckBreakdownGroups({ main: [{ type: null, frameType: null, quantity: 2 }], extra: [] })).toEqual([
      { section: 'main', kinds: [{ kind: 'other', count: 2 }] },
    ])
  })
})
