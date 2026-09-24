import { describe, expect, it } from 'vitest'
import { avatarColorClasses, avatarInitials } from '~/utils/avatar'

describe('avatarInitials', () => {
  it('takes the first letter of the first and last word, uppercased', () => {
    expect(avatarInitials('fabian meyer')).toBe('FM')
    expect(avatarInitials('Anna Maria von Berg')).toBe('AB')
    expect(avatarInitials('  Fabian  ')).toBe('F')
  })

  it('keeps an emoji (astral code point) whole', () => {
    expect(avatarInitials('\u{1F409} Drache')).toBe('\u{1F409}D')
    expect(avatarInitials('\u{1F0CF}')).toBe('\u{1F0CF}')
  })

  it('falls back to "?" for an empty name', () => {
    expect(avatarInitials('')).toBe('?')
    expect(avatarInitials('   ')).toBe('?')
  })
})

describe('avatarColorClasses', () => {
  it('is stable for the same handle', () => {
    expect(avatarColorClasses('fabian')).toEqual(avatarColorClasses('fabian'))
  })

  it('spreads different handles across several colors', () => {
    const handles = ['fabian', 'anna', 'ben', 'carla', 'dino', 'emil', 'frieda', 'gustav', 'hanna', 'ida']
    const colors = new Set(handles.map(handle => avatarColorClasses(handle).bg))
    expect(colors.size).toBeGreaterThan(2)
  })

  it('returns literal background and text classes', () => {
    const { bg, text } = avatarColorClasses('fabian')
    expect(bg).toMatch(/^bg-[a-z]+-100$/)
    expect(text).toMatch(/^text-[a-z]+-800$/)
  })

  it('pairs every color with a dark-mode variant of the same hue', () => {
    const { bg, darkBg, darkText } = avatarColorClasses('fabian')
    const hue = bg.split('-')[1]
    expect(darkBg).toBe(`dark:bg-${hue}-400/15`)
    expect(darkText).toBe(`dark:text-${hue}-200`)
  })
})
