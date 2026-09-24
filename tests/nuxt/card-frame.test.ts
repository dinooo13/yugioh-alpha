import { describe, expect, it } from 'vitest'
import { attributeKey, cardFrame } from '~/utils/card-frame'

describe('cardFrame', () => {
  it('prefers YGOPRODeck\'s frameType and splits off the pendulum half', () => {
    expect(cardFrame({ type: 'Effect Monster', frameType: 'effect' })).toEqual({ frame: 'effect', pendulum: false })
    expect(cardFrame({ type: 'Pendulum Effect Monster', frameType: 'effect_pendulum' })).toEqual({ frame: 'effect', pendulum: true })
    expect(cardFrame({ type: 'XYZ Pendulum Effect Monster', frameType: 'xyz_pendulum' })).toEqual({ frame: 'xyz', pendulum: true })
    expect(cardFrame({ type: 'Spell Card', frameType: 'SPELL' })).toEqual({ frame: 'spell', pendulum: false })
  })

  it('falls back to the type line when frameType is missing or unknown', () => {
    expect(cardFrame({ type: 'Link Monster' })).toEqual({ frame: 'link', pendulum: false })
    expect(cardFrame({ type: 'Synchro Tuner Monster', frameType: null })).toEqual({ frame: 'synchro', pendulum: false })
    expect(cardFrame({ type: 'Ritual Effect Monster' })).toEqual({ frame: 'ritual', pendulum: false })
    expect(cardFrame({ type: 'Pendulum Effect Fusion Monster' })).toEqual({ frame: 'fusion', pendulum: true })
    expect(cardFrame({ type: 'Trap Card', frameType: 'mystery' })).toEqual({ frame: 'trap', pendulum: false })
    expect(cardFrame({ type: 'Token' })).toEqual({ frame: 'token', pendulum: false })
    expect(cardFrame({ type: 'Skill Card' })).toEqual({ frame: 'skill', pendulum: false })
    expect(cardFrame({ type: 'Normal Tuner Monster' })).toEqual({ frame: 'normal', pendulum: false })
    expect(cardFrame({ type: 'Pendulum Normal Monster' })).toEqual({ frame: 'normal', pendulum: true })
  })

  it('treats any other monster as an Effect monster', () => {
    expect(cardFrame({ type: 'Flip Effect Monster' })).toEqual({ frame: 'effect', pendulum: false })
    expect(cardFrame({ type: 'Toon Monster' })).toEqual({ frame: 'effect', pendulum: false })
    expect(cardFrame({ type: 'Union Effect Monster' })).toEqual({ frame: 'effect', pendulum: false })
  })

  it('is null without a type or frame', () => {
    expect(cardFrame({})).toBeNull()
    expect(cardFrame({ type: '  ', frameType: null })).toBeNull()
  })
})

describe('attributeKey', () => {
  it('maps the stored attribute to its orb key, ignoring case', () => {
    expect(attributeKey('DARK')).toBe('dark')
    expect(attributeKey('Light')).toBe('light')
    expect(attributeKey('DIVINE')).toBe('divine')
  })

  it('is null for none or an unknown value', () => {
    expect(attributeKey(null)).toBeNull()
    expect(attributeKey(undefined)).toBeNull()
    expect(attributeKey('LAUGH')).toBeNull()
  })
})
