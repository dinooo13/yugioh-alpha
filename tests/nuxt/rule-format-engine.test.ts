import { describe, expect, it } from 'vitest'
import {
  banlistCopies,
  cardHasEffect,
  describeRule,
  evaluateDeck,
  matchesCardFilter,
  RuleSetValidationError,
  validateRuleSet,
} from '../../shared/rule-formats'
import type { DeckCardEntry, Rule, ValidationCardData } from '../../shared/rule-formats'

// Real cards from the E2E catalog fixture (server/db/fixtures/catalog-fixture.ts),
// reduced to the fields the engine reads.
const CARDS = {
  darkMagician: {
    id: 46986414,
    name: 'Dark Magician',
    type: 'Normal Monster',
    frameType: 'normal',
    attribute: 'DARK',
    race: 'Spellcaster',
    archetype: 'Dark Magician',
    level: 7,
    atk: 2500,
    def: 2100,
    banlistInfo: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-02-04',
    setIds: ['starter-deck-yugi', 'legend-of-blue-eyes-white-dragon'],
  },
  kuriboh: {
    id: 40640057,
    name: 'Kuriboh',
    type: 'Effect Monster',
    frameType: 'effect',
    attribute: 'DARK',
    race: 'Fiend',
    archetype: 'Kuriboh',
    level: 1,
    atk: 300,
    def: 200,
    banlistInfo: null,
    tcgDate: '2002-06-26',
    ocgDate: '2000-01-27',
    setIds: ['metal-raiders'],
  },
  potOfGreed: {
    id: 55144522,
    name: 'Pot of Greed',
    type: 'Spell Card',
    frameType: 'spell',
    attribute: null,
    race: 'Normal',
    archetype: 'Greed',
    level: null,
    atk: null,
    def: null,
    banlistInfo: { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden', ban_goat: 'Limited' },
    tcgDate: '2002-03-08',
    ocgDate: '1999-05-27',
    setIds: ['legend-of-blue-eyes-white-dragon'],
  },
  monsterReborn: {
    id: 83764719,
    name: 'Monster Reborn',
    type: 'Spell Card',
    frameType: 'spell',
    attribute: null,
    race: 'Normal',
    archetype: null,
    level: null,
    atk: null,
    def: null,
    banlistInfo: { ban_tcg: 'Limited', ban_ocg: 'Limited', ban_goat: 'Forbidden' },
    tcgDate: '2002-03-08',
    ocgDate: '1999-03-27',
    setIds: ['legend-of-blue-eyes-white-dragon'],
  },
  raigeki: {
    id: 12580477,
    name: 'Raigeki',
    type: 'Spell Card',
    frameType: 'spell',
    attribute: null,
    race: 'Normal',
    archetype: null,
    level: null,
    atk: null,
    def: null,
    // Unlimited in TCG/OCG today, still Forbidden on the GOAT list.
    banlistInfo: { ban_goat: 'Forbidden' },
    tcgDate: '2002-03-08',
    ocgDate: '1999-03-06',
    setIds: ['legend-of-blue-eyes-white-dragon'],
  },
  stardustDragon: {
    id: 44508094,
    name: 'Stardust Dragon',
    type: 'Synchro Monster',
    frameType: 'synchro',
    attribute: 'WIND',
    race: 'Dragon',
    archetype: 'Stardust',
    level: 8,
    atk: 2500,
    def: 2000,
    banlistInfo: null,
    tcgDate: '2008-09-02',
    ocgDate: '2008-04-19',
    setIds: ['the-duelist-genesis'],
  },
  // OCG-only release: no TCG date at all.
  ocgOnly: {
    id: 999001,
    name: 'Nur im OCG',
    type: 'Effect Monster',
    frameType: 'effect',
    attribute: 'FIRE',
    race: 'Warrior',
    archetype: null,
    level: 4,
    atk: 1800,
    def: 1000,
    banlistInfo: null,
    tcgDate: null,
    ocgDate: '2003-05-15',
    setIds: [],
  },
} as const satisfies Record<string, ValidationCardData>

const ALL_CARDS = Object.values(CARDS) as ValidationCardData[]

function card(name: keyof typeof CARDS, section: DeckCardEntry['section'], quantity: number): DeckCardEntry {
  return { catalogCardId: CARDS[name].id, section, quantity }
}

function codes(issues: Array<{ code: string }>) {
  return issues.map(issue => issue.code)
}

describe('card predicates', () => {
  it('treats every non-Normal monster and all spells/traps as having an effect', () => {
    expect(cardHasEffect({ type: 'Normal Monster' })).toBe(false)
    expect(cardHasEffect({ type: 'Normal Tuner Monster' })).toBe(false)
    expect(cardHasEffect({ type: 'Pendulum Normal Monster' })).toBe(false)

    expect(cardHasEffect({ type: 'Effect Monster' })).toBe(true)
    expect(cardHasEffect({ type: 'Synchro Monster' })).toBe(true)
    // "Normal" here is the *race*, not the type — spells always have an effect.
    expect(cardHasEffect({ type: 'Spell Card' })).toBe(true)
    expect(cardHasEffect({ type: 'Trap Card' })).toBe(true)
    expect(cardHasEffect({ type: 'Skill Card' })).toBe(true)
  })

  it('maps banlist values to copy limits', () => {
    expect(banlistCopies('Forbidden')).toBe(0)
    expect(banlistCopies('Limited')).toBe(1)
    expect(banlistCopies('Semi-Limited')).toBe(2)
    expect(banlistCopies('semi limited')).toBe(2)
    expect(banlistCopies(undefined)).toBeNull()
    expect(banlistCopies('Unlimited')).toBeNull()
  })
})

describe('card filter matching', () => {
  it('ANDs fields and ORs the values inside a field', () => {
    expect(matchesCardFilter({}, CARDS.darkMagician)).toBe(true)

    expect(matchesCardFilter({ types: ['Spell Card', 'Trap Card'] }, CARDS.potOfGreed)).toBe(true)
    expect(matchesCardFilter({ types: ['Spell Card'] }, CARDS.darkMagician)).toBe(false)

    expect(matchesCardFilter({ attributes: ['DARK'], races: ['Spellcaster'] }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ attributes: ['DARK'], races: ['Dragon'] }, CARDS.darkMagician)).toBe(false)

    // A card without the field never matches a filter on it.
    expect(matchesCardFilter({ attributes: ['DARK'] }, CARDS.potOfGreed)).toBe(false)
  })

  it('matches sets by printing, card ids, name, and effect', () => {
    expect(matchesCardFilter({ setIds: ['starter-deck-yugi'] }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ setIds: ['metal-raiders'] }, CARDS.darkMagician)).toBe(false)

    expect(matchesCardFilter({ cardIds: [CARDS.kuriboh.id] }, CARDS.kuriboh)).toBe(true)
    expect(matchesCardFilter({ cardIds: [CARDS.kuriboh.id] }, CARDS.darkMagician)).toBe(false)

    expect(matchesCardFilter({ nameContains: 'magician' }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ nameContains: 'dragon' }, CARDS.darkMagician)).toBe(false)

    expect(matchesCardFilter({ hasEffect: false }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ hasEffect: false }, CARDS.kuriboh)).toBe(false)
    expect(matchesCardFilter({ hasEffect: true }, CARDS.kuriboh)).toBe(true)
  })

  it('matches numeric ranges and skips cards without the value', () => {
    expect(matchesCardFilter({ levelMin: 7 }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ levelMin: 8 }, CARDS.darkMagician)).toBe(false)
    expect(matchesCardFilter({ levelMin: 1, levelMax: 4 }, CARDS.kuriboh)).toBe(true)

    expect(matchesCardFilter({ atkMin: 2500 }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ atkMin: 2000, atkMax: 2400 }, CARDS.darkMagician)).toBe(false)
    // Spells have no ATK, so an ATK filter can never match them.
    expect(matchesCardFilter({ atkMin: 0 }, CARDS.potOfGreed)).toBe(false)
  })

  it('compares release dates strictly and per region, and never matches an unknown date', () => {
    expect(matchesCardFilter({ releasedBefore: '2005-07-01' }, CARDS.darkMagician)).toBe(true)
    expect(matchesCardFilter({ releasedBefore: '2005-07-01' }, CARDS.stardustDragon)).toBe(false)
    expect(matchesCardFilter({ releasedAfter: '2005-07-01' }, CARDS.stardustDragon)).toBe(true)

    // Strictly before/after: the boundary date itself does not match.
    expect(matchesCardFilter({ releasedBefore: '2002-03-08' }, CARDS.darkMagician)).toBe(false)
    expect(matchesCardFilter({ releasedAfter: '2002-03-08' }, CARDS.darkMagician)).toBe(false)

    // Missing TCG date -> no match, whichever direction is asked for.
    expect(matchesCardFilter({ releasedBefore: '2005-07-01' }, CARDS.ocgOnly)).toBe(false)
    expect(matchesCardFilter({ releasedAfter: '1990-01-01' }, CARDS.ocgOnly)).toBe(false)
    // ...but the OCG date is known.
    expect(matchesCardFilter({ releasedBefore: '2005-07-01', region: 'ocg' }, CARDS.ocgOnly)).toBe(true)
    expect(matchesCardFilter({ releasedBefore: '2001-01-01', region: 'ocg' }, CARDS.darkMagician)).toBe(true)
  })
})

describe('deck size rules', () => {
  const rules: Rule[] = [
    { kind: 'deck_size', section: 'main', min: 40, max: 60 },
    { kind: 'deck_size', section: 'extra', max: 15 },
    { kind: 'deck_size', section: 'side', max: 15 },
  ]

  it('reports a section below its minimum and above its maximum', () => {
    const tooSmall = evaluateDeck(rules, [card('darkMagician', 'main', 3)], ALL_CARDS)
    expect(tooSmall.legal).toBe(false)
    expect(codes(tooSmall.issues)).toEqual(['deck_size_min'])
    expect(tooSmall.issues[0]!.section).toBe('main')
    expect(tooSmall.issues[0]!.message).toContain('Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.')

    const tooBig = evaluateDeck(rules, [
      card('darkMagician', 'main', 40),
      card('stardustDragon', 'extra', 16),
    ], ALL_CARDS)
    expect(codes(tooBig.issues)).toContain('deck_size_max')
    expect(tooBig.issues.find(issue => issue.code === 'deck_size_max')!.message)
      .toContain('Das Extra Deck hat 16 Karten, höchstens 15 sind erlaubt.')
  })

  it('is silent when every section is within range', () => {
    // 10 copies each so the deck reaches 40 main cards with the fixture's
    // handful of cards; the copy limit is raised accordingly.
    const result = evaluateDeck([...rules, { kind: 'copies', maxCopies: 10 }], [
      card('darkMagician', 'main', 10),
      card('kuriboh', 'main', 10),
      card('potOfGreed', 'main', 10),
      card('monsterReborn', 'main', 10),
      card('stardustDragon', 'extra', 3),
      card('raigeki', 'side', 3),
    ], ALL_CARDS)

    expect(result.legal).toBe(true)
    expect(result.issues).toEqual([])
  })
})

describe('copy limits', () => {
  it('defaults to 3 copies across all sections', () => {
    const legal = evaluateDeck([], [card('kuriboh', 'main', 2), card('kuriboh', 'side', 1)], ALL_CARDS)
    expect(legal.legal).toBe(true)
    expect(legal.cards[CARDS.kuriboh.id]).toEqual({ maxCopies: 3, status: 'unrestricted', reasons: [] })

    const tooMany = evaluateDeck([], [card('kuriboh', 'main', 3), card('kuriboh', 'side', 1)], ALL_CARDS)
    expect(codes(tooMany.issues)).toEqual(['card_limit_exceeded'])
    expect(tooMany.issues[0]!.cardId).toBe(CARDS.kuriboh.id)
    expect(tooMany.issues[0]!.message).toBe('Kuriboh: 4 Kopien im Deck, erlaubt sind 3 Kopien.')
  })

  it('honours a custom copies rule in both directions', () => {
    const singleton: Rule[] = [{ kind: 'copies', maxCopies: 1 }]
    const result = evaluateDeck(singleton, [card('kuriboh', 'main', 2)], ALL_CARDS)
    expect(codes(result.issues)).toEqual(['card_limit_exceeded'])
    expect(result.cards[CARDS.kuriboh.id]!.status).toBe('limited')

    // A format may also allow *more* than the default three copies.
    const generous = evaluateDeck([{ kind: 'copies', maxCopies: 5 }], [card('kuriboh', 'main', 5)], ALL_CARDS)
    expect(generous.legal).toBe(true)
    expect(generous.cards[CARDS.kuriboh.id]!.maxCopies).toBe(5)
  })

  it('reports an unknown card instead of silently skipping it', () => {
    const result = evaluateDeck([], [{ catalogCardId: 123456, section: 'main', quantity: 1 }], ALL_CARDS)
    expect(codes(result.issues)).toEqual(['unknown_card_data'])
    expect(result.cards[123456]).toBeUndefined()
  })
})

describe('card_status rules', () => {
  const rules: Rule[] = [
    { kind: 'card_status', status: 'forbidden', cardIds: [CARDS.potOfGreed.id] },
    { kind: 'card_status', status: 'limited', cardIds: [CARDS.monsterReborn.id] },
    { kind: 'card_status', status: 'semi_limited', cardIds: [CARDS.kuriboh.id] },
  ]

  it('forbids, limits, and semi-limits the listed cards', () => {
    const result = evaluateDeck(rules, [
      card('potOfGreed', 'main', 1),
      card('monsterReborn', 'main', 1),
      card('kuriboh', 'main', 2),
    ], ALL_CARDS)

    expect(result.legal).toBe(false)
    expect(codes(result.issues)).toEqual(['card_forbidden'])
    expect(result.issues[0]!.message).toBe('Pot of Greed ist in diesem Format verboten.')

    expect(result.cards[CARDS.potOfGreed.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.monsterReborn.id]).toEqual({
      maxCopies: 1,
      status: 'limited',
      reasons: ['Formatregel: limitiert (1)'],
    })
    expect(result.cards[CARDS.kuriboh.id]!.maxCopies).toBe(2)
  })

  it('counts copies of a limited card across main, extra, and side', () => {
    const result = evaluateDeck(rules, [
      card('kuriboh', 'main', 2),
      card('kuriboh', 'side', 1),
    ], ALL_CARDS)

    expect(codes(result.issues)).toEqual(['card_limit_exceeded'])
    expect(result.issues[0]!.message).toBe('Kuriboh: 3 Kopien im Deck, erlaubt sind 2 Kopien.')
  })
})

describe('banlist rules', () => {
  it('reads the TCG list', () => {
    const result = evaluateDeck([{ kind: 'banlist', source: 'tcg' }], [
      card('potOfGreed', 'main', 1),
      card('monsterReborn', 'main', 2),
      card('raigeki', 'main', 3),
    ], ALL_CARDS)

    expect(result.cards[CARDS.potOfGreed.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.potOfGreed.id]!.reasons).toEqual(['TCG-Banliste: Forbidden'])
    expect(result.cards[CARDS.monsterReborn.id]!.maxCopies).toBe(1)
    // Raigeki is unlimited in the TCG today.
    expect(result.cards[CARDS.raigeki.id]!.status).toBe('unrestricted')

    expect([...codes(result.issues)].sort()).toEqual(['card_forbidden', 'card_limit_exceeded'])
  })

  it('reads the OCG list', () => {
    const result = evaluateDeck([{ kind: 'banlist', source: 'ocg' }], [
      card('potOfGreed', 'main', 1),
      card('monsterReborn', 'main', 1),
    ], ALL_CARDS)

    expect(result.cards[CARDS.potOfGreed.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.monsterReborn.id]!.status).toBe('limited')
    expect(codes(result.issues)).toEqual(['card_forbidden'])
  })

  it('reads the GOAT list, which differs from the TCG list', () => {
    const result = evaluateDeck([{ kind: 'banlist', source: 'goat' }], [
      card('potOfGreed', 'main', 1),
      card('monsterReborn', 'main', 1),
      card('raigeki', 'main', 1),
    ], ALL_CARDS)

    // Limited on GOAT, Forbidden in the TCG.
    expect(result.cards[CARDS.potOfGreed.id]!.status).toBe('limited')
    expect(result.cards[CARDS.monsterReborn.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.raigeki.id]!.status).toBe('forbidden')

    expect(result.issues.map(issue => issue.message)).toEqual([
      'Monster Reborn ist in diesem Format verboten.',
      'Raigeki ist in diesem Format verboten.',
    ])
  })
})

describe('filter rules', () => {
  it('restricts matching cards', () => {
    const rules: Rule[] = [{
      kind: 'filter',
      match: 'matching',
      filter: { types: ['Spell Card'] },
      maxCopies: 1,
      label: 'Zauber nur einmal',
    }]

    const result = evaluateDeck(rules, [card('potOfGreed', 'main', 2), card('darkMagician', 'main', 3)], ALL_CARDS)

    expect(result.cards[CARDS.potOfGreed.id]).toEqual({
      maxCopies: 1,
      status: 'limited',
      reasons: ['Zauber nur einmal'],
    })
    expect(result.cards[CARDS.darkMagician.id]!.status).toBe('unrestricted')
    expect(codes(result.issues)).toEqual(['card_limit_exceeded'])
  })

  it('restricts everything a filter does not match (GOAT-style release cut-off)', () => {
    const rules: Rule[] = [{
      kind: 'filter',
      match: 'not_matching',
      filter: { releasedBefore: '2005-07-01', region: 'tcg' },
      maxCopies: 0,
      label: 'Nur Karten bis Juni 2005',
    }]

    const result = evaluateDeck(rules, [
      card('darkMagician', 'main', 3),
      card('stardustDragon', 'extra', 1),
      // No TCG date at all -> conservatively forbidden by the same rule.
      card('ocgOnly', 'main', 1),
    ], ALL_CARDS)

    expect(result.cards[CARDS.darkMagician.id]!.status).toBe('unrestricted')
    expect(result.cards[CARDS.stardustDragon.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.ocgOnly.id]!.status).toBe('forbidden')
    expect(result.cards[CARDS.ocgOnly.id]!.reasons).toEqual(['Nur Karten bis Juni 2005'])
    expect(codes(result.issues)).toEqual(['card_forbidden', 'card_forbidden'])
  })

  it('can use the OCG release date instead', () => {
    const rules: Rule[] = [{
      kind: 'filter',
      match: 'not_matching',
      filter: { releasedBefore: '2005-07-01', region: 'ocg' },
      maxCopies: 0,
    }]

    const result = evaluateDeck(rules, [card('ocgOnly', 'main', 1), card('stardustDragon', 'extra', 1)], ALL_CARDS)

    expect(result.cards[CARDS.ocgOnly.id]!.status).toBe('unrestricted')
    expect(result.cards[CARDS.stardustDragon.id]!.status).toBe('forbidden')
  })

  it('filters on attributes, sets, levels, ATK, and effects', () => {
    const byAttribute = evaluateDeck(
      [{ kind: 'filter', match: 'matching', filter: { attributes: ['DARK'], levelMin: 5 }, maxCopies: 1 }],
      [card('darkMagician', 'main', 2), card('kuriboh', 'main', 3)],
      ALL_CARDS,
    )
    expect(byAttribute.cards[CARDS.darkMagician.id]!.maxCopies).toBe(1)
    expect(byAttribute.cards[CARDS.kuriboh.id]!.maxCopies).toBe(3)

    const bySet = evaluateDeck(
      [{ kind: 'filter', match: 'matching', filter: { setIds: ['metal-raiders'] }, maxCopies: 0 }],
      [card('kuriboh', 'main', 1), card('darkMagician', 'main', 1)],
      ALL_CARDS,
    )
    expect(bySet.cards[CARDS.kuriboh.id]!.status).toBe('forbidden')
    expect(bySet.cards[CARDS.darkMagician.id]!.status).toBe('unrestricted')

    const byAtk = evaluateDeck(
      [{ kind: 'filter', match: 'matching', filter: { atkMin: 2500 }, maxCopies: 2 }],
      [card('darkMagician', 'main', 3), card('kuriboh', 'main', 3)],
      ALL_CARDS,
    )
    expect(byAtk.cards[CARDS.darkMagician.id]!.maxCopies).toBe(2)
    expect(byAtk.cards[CARDS.kuriboh.id]!.maxCopies).toBe(3)

    const byEffect = evaluateDeck(
      [{ kind: 'filter', match: 'matching', filter: { hasEffect: true }, maxCopies: 1 }],
      [card('kuriboh', 'main', 1), card('darkMagician', 'main', 3)],
      ALL_CARDS,
    )
    expect(byEffect.cards[CARDS.kuriboh.id]!.maxCopies).toBe(1)
    expect(byEffect.cards[CARDS.darkMagician.id]!.maxCopies).toBe(3)
  })
})

describe('rule interplay', () => {
  it('takes the lowest limit of every applicable rule and lists all reasons', () => {
    const rules: Rule[] = [
      { kind: 'copies', maxCopies: 3 },
      { kind: 'banlist', source: 'goat' },
      { kind: 'filter', match: 'matching', filter: { types: ['Spell Card'] }, maxCopies: 2, label: 'Zauber semi' },
      { kind: 'card_status', status: 'forbidden', cardIds: [CARDS.raigeki.id] },
    ]

    const result = evaluateDeck(rules, [card('potOfGreed', 'main', 1), card('raigeki', 'main', 1)], ALL_CARDS)

    // GOAT limits Pot of Greed to 1, the filter would allow 2 -> 1 wins.
    expect(result.cards[CARDS.potOfGreed.id]!.maxCopies).toBe(1)
    expect(result.cards[CARDS.potOfGreed.id]!.reasons).toEqual(['GOAT-Banliste: Limited', 'Zauber semi'])

    expect(result.cards[CARDS.raigeki.id]!.maxCopies).toBe(0)
    expect(result.cards[CARDS.raigeki.id]!.reasons).toEqual([
      'GOAT-Banliste: Forbidden',
      'Zauber semi',
      'Formatregel: verboten',
    ])
  })

  it('is legal when the deck respects every limit', () => {
    const result = evaluateDeck(
      [{ kind: 'banlist', source: 'tcg' }, { kind: 'deck_size', section: 'main', min: 2 }],
      [card('monsterReborn', 'main', 1), card('darkMagician', 'main', 3)],
      ALL_CARDS,
    )

    expect(result.legal).toBe(true)
    expect(result.issues).toEqual([])
  })
})

describe('rule summaries', () => {
  it('describes every rule kind in German', () => {
    expect(describeRule({ kind: 'deck_size', section: 'main', min: 40, max: 60 }))
      .toBe('Main Deck: 40–60 Karten')
    expect(describeRule({ kind: 'deck_size', section: 'extra', max: 15 }))
      .toBe('Extra Deck: höchstens 15 Karten')
    expect(describeRule({ kind: 'copies', maxCopies: 3 })).toBe('Höchstens 3 Kopien pro Karte')
    expect(describeRule({ kind: 'banlist', source: 'goat' })).toBe('Offizielle Banliste (GOAT)')

    expect(describeRule(
      { kind: 'card_status', status: 'forbidden', cardIds: [CARDS.potOfGreed.id] },
      { cardNames: { [CARDS.potOfGreed.id]: 'Pot of Greed' } },
    )).toBe('Verboten: Pot of Greed')

    expect(describeRule({
      kind: 'filter',
      match: 'matching',
      filter: { releasedAfter: '2005-07-01' },
      maxCopies: 0,
    })).toBe('Karten mit erschienen nach dem 01.07.2005 (TCG): verboten')

    expect(describeRule({
      kind: 'filter',
      match: 'not_matching',
      filter: { releasedBefore: '2005-07-01', region: 'tcg' },
      maxCopies: 0,
      label: 'Nur Karten bis Juni 2005',
    })).toContain('Nur Karten bis Juni 2005')
  })
})

describe('validateRuleSet', () => {
  it('normalizes a valid rule set and drops unknown keys', () => {
    const result = validateRuleSet({
      rules: [
        { kind: 'deck_size', section: 'main', min: '40', max: '60', nonsense: true },
        { kind: 'copies', max_copies: 3 },
        { kind: 'card_status', status: 'limited', cardIds: [1, 1, 2] },
        { kind: 'banlist', source: 'tcg' },
        {
          kind: 'filter',
          match: 'not_matching',
          maxCopies: 0,
          label: '  Alte Karten  ',
          filter: { types: ['Spell Card', 'Spell Card'], releasedBefore: '2005-07-01', region: 'ocg', nameContains: '  Dark  ' },
        },
      ],
    })

    expect(result.rules).toEqual([
      { kind: 'deck_size', section: 'main', min: 40, max: 60 },
      { kind: 'copies', maxCopies: 3 },
      { kind: 'card_status', status: 'limited', cardIds: [1, 2] },
      { kind: 'banlist', source: 'tcg' },
      {
        kind: 'filter',
        match: 'not_matching',
        maxCopies: 0,
        label: 'Alte Karten',
        filter: { types: ['Spell Card'], releasedBefore: '2005-07-01', region: 'ocg', nameContains: 'Dark' },
      },
    ])
  })

  it('accepts an empty rule set', () => {
    expect(validateRuleSet({ rules: [] })).toEqual({ rules: [] })
  })

  it('rejects malformed rule sets', () => {
    const invalid: unknown[] = [
      'nope',
      { rules: 'nope' },
      { rules: [{ kind: 'nonsense' }] },
      { rules: [{ kind: 'deck_size', section: 'graveyard', min: 1 }] },
      // min > max
      { rules: [{ kind: 'deck_size', section: 'main', min: 60, max: 40 }] },
      // neither min nor max
      { rules: [{ kind: 'deck_size', section: 'main' }] },
      { rules: [{ kind: 'copies', maxCopies: 0 }] },
      { rules: [{ kind: 'copies', maxCopies: 11 }] },
      { rules: [{ kind: 'card_status', status: 'banned', cardIds: [1] }] },
      { rules: [{ kind: 'card_status', status: 'forbidden', cardIds: [] }] },
      { rules: [{ kind: 'card_status', status: 'forbidden', cardIds: [-1] }] },
      { rules: [{ kind: 'banlist', source: 'edison' }] },
      { rules: [{ kind: 'filter', match: 'sometimes', maxCopies: 0, filter: {} }] },
      { rules: [{ kind: 'filter', match: 'matching', maxCopies: 4, filter: {} }] },
      { rules: [{ kind: 'filter', match: 'matching', maxCopies: 0, filter: { releasedBefore: '01.07.2005' } }] },
      { rules: [{ kind: 'filter', match: 'matching', maxCopies: 0, filter: { releasedBefore: '2005-02-31' } }] },
      { rules: [{ kind: 'filter', match: 'matching', maxCopies: 0, filter: { levelMin: 8, levelMax: 4 } }] },
      { rules: [{ kind: 'filter', match: 'matching', maxCopies: 0, filter: { region: 'eu' } }] },
      // more than 50 rules
      { rules: Array.from({ length: 51 }, () => ({ kind: 'banlist', source: 'tcg' })) },
    ]

    for (const input of invalid) {
      expect(() => validateRuleSet(input), JSON.stringify(input).slice(0, 80)).toThrow(RuleSetValidationError)
    }
  })

  it('bounds list fields', () => {
    expect(() => validateRuleSet({
      rules: [{ kind: 'card_status', status: 'forbidden', cardIds: Array.from({ length: 201 }, (_, index) => index + 1) }],
    })).toThrow(RuleSetValidationError)
  })
})
