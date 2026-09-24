import { describe, expect, it } from 'vitest'
import { foldCardName } from '../../shared/card-name-fold'

describe('foldCardName', () => {
  it.each([
    ['Dunkler Magier', 'dunklermagier'],
    ['Blauäugiger w. Drache', 'blauaugigerwdrache'],
    ['BLAUÄUGIGER', 'blauaugiger'],
    ['Blue-Eyes White Dragon', 'blueeyeswhitedragon'],
    ['Straße', 'strasse'],
    ['STRASSE', 'strasse'],
    ['ẞ', 'ss'],
    ['Nummer 39: Utopia', 'nummer39utopia'],
    ['Élan', 'elan'],
    ['Ｄａｒｋ', 'dark'],
    ['Æ', 'ae'],
    ['Œ', 'oe'],
    ['Ø', 'o'],
    ['æ œ ø ł đ Ł Đ', 'aeoeoldld'],
    ['---', ''],
    ['', ''],
  ])('folds %j to %j', (input, expected) => {
    expect(foldCardName(input)).toBe(expected)
  })

  it('never produces LIKE wildcards', () => {
    expect(foldCardName('100% _Pot_ of Greed')).toBe('100potofgreed')
  })

  it('is idempotent', () => {
    for (const input of ['Blauäugiger w. Drache', 'Straße', 'Ｄａｒｋ Magician', 'Nummer 39: Utopia', 'Æther']) {
      const once = foldCardName(input)
      expect(foldCardName(once)).toBe(once)
    }
  })

  it('folds a partial query to a substring of the folded name', () => {
    expect(foldCardName('Dunkler Magier')).toContain(foldCardName('dunkler mag'))
    expect(foldCardName('Blauäugiger w. Drache')).toContain(foldCardName('BLAUAUGIGER W'))
  })
})
