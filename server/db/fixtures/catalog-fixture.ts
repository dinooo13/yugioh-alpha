// Small, deterministic card catalog fixture for E2E and unit tests.
//
// This is a hand-picked subset of real Yu-Gi-Oh cards (real YGOPRODeck
// passcodes, set codes, stats, and release dates) rather than a snapshot of
// the full `catalog:sync` import. It's deliberately varied — Normal, Effect,
// Fusion, Synchro, XYZ, Link, and Pendulum monsters, plus Spell/Trap cards
// with banlist data — so upcoming feature branches (fast card entry,
// deckbuilder, rule formats) have real, stable fixtures to build E2E tests
// against without depending on network access to YGOPRODeck.
import type { useDb } from '../index'
import { catalogCard, catalogCardImage, catalogPrinting, catalogSet } from '../schema'

type Db = ReturnType<typeof useDb>

type CatalogCardRow = typeof catalogCard.$inferInsert
type CatalogSetRow = typeof catalogSet.$inferInsert
type CatalogPrintingRow = typeof catalogPrinting.$inferInsert
type CatalogCardImageRow = typeof catalogCardImage.$inferInsert

// Fixed instant so re-running the fixture (or diffing seeded rows) is
// deterministic instead of depending on wall-clock time.
const SYNCED_AT = new Date('2025-01-01T00:00:00.000Z')

/** Readable keys to YGOPRODeck passcodes, for tests to reference cards by name. */
export const CATALOG_FIXTURE_IDS = {
  darkMagician: 46986414,
  blueEyesWhiteDragon: 89631139,
  summonedSkull: 70781052,
  kuriboh: 40640057,
  potOfGreed: 55144522,
  raigeki: 12580477,
  monsterReborn: 83764719,
  mirrorForce: 44095762,
  blueEyesUltimateDragon: 23995346,
  stardustDragon: 44508094,
  utopia: 84013237,
  decodeTalker: 1861629,
  oddEyesPendulumDragon: 16178681,
  effectVeiler: 97268402,
} as const satisfies Record<string, number>

function imageUrls(id: number) {
  return {
    imageUrl: `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
    imageUrlSmall: `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
    imageUrlCropped: `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`,
  }
}

export const CATALOG_FIXTURE_CARDS: CatalogCardRow[] = [
  {
    id: CATALOG_FIXTURE_IDS.darkMagician,
    name: 'Dark Magician',
    type: 'Normal Monster',
    frameType: 'normal',
    desc: '\'\'The ultimate wizard in terms of attack and defense.\'\'',
    race: 'Spellcaster',
    archetype: 'Dark Magician',
    attribute: 'DARK',
    atk: 2500,
    def: 2100,
    level: 7,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-02-04',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/dark-magician-4003',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.blueEyesWhiteDragon,
    name: 'Blue-Eyes White Dragon',
    type: 'Normal Monster',
    frameType: 'normal',
    desc: 'This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.',
    race: 'Dragon',
    archetype: 'Blue-Eyes',
    attribute: 'LIGHT',
    atk: 3000,
    def: 2500,
    level: 8,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-03-06',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/blue-eyes-white-dragon-7485',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.summonedSkull,
    name: 'Summoned Skull',
    type: 'Normal Monster',
    frameType: 'normal',
    desc: 'A fiend with dark powers for confusing the enemy. Among the Fiend-Type monsters, this monster boasts considerable force.\n\n(This card is always treated as an "Archfiend" card.)',
    race: 'Fiend',
    archetype: 'Archfiend',
    attribute: 'DARK',
    atk: 2500,
    def: 1200,
    level: 6,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2001-01-01',
    ocgDate: '1999-07-22',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/summoned-skull-5941',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.kuriboh,
    name: 'Kuriboh',
    type: 'Effect Monster',
    frameType: 'effect',
    desc: 'During damage calculation, if your opponent\'s monster attacks (Quick Effect): You can discard this card; you take no battle damage from that battle.',
    race: 'Fiend',
    archetype: 'Kuriboh',
    attribute: 'DARK',
    atk: 300,
    def: 200,
    level: 1,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2002-06-26',
    ocgDate: '2000-01-27',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/kuriboh-3456',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.potOfGreed,
    name: 'Pot of Greed',
    type: 'Spell Card',
    frameType: 'spell',
    desc: 'Draw 2 cards.',
    race: 'Normal',
    archetype: 'Greed',
    attribute: null,
    atk: null,
    def: null,
    level: null,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden', ban_goat: 'Limited' },
    cardPrices: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-05-27',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/pot-of-greed-4698',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.raigeki,
    name: 'Raigeki',
    type: 'Spell Card',
    frameType: 'spell',
    desc: 'Destroy all monsters your opponent controls.',
    race: 'Normal',
    archetype: null,
    attribute: null,
    atk: null,
    def: null,
    level: null,
    linkval: null,
    scale: null,
    linkMarkers: null,
    // Unlimited in the TCG/OCG as of 2025; still Forbidden on the GOAT format banlist.
    banlistInfo: { ban_goat: 'Forbidden' },
    cardPrices: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-03-06',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/raigeki-1087',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.monsterReborn,
    name: 'Monster Reborn',
    type: 'Spell Card',
    frameType: 'spell',
    desc: 'Target 1 monster in either GY; Special Summon it.',
    race: 'Normal',
    archetype: null,
    attribute: null,
    atk: null,
    def: null,
    level: null,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: { ban_tcg: 'Limited', ban_ocg: 'Limited', ban_goat: 'Forbidden' },
    cardPrices: null,
    tcgDate: '2002-03-08',
    ocgDate: '1999-03-27',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/monster-reborn-7027',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.mirrorForce,
    name: 'Mirror Force',
    type: 'Trap Card',
    frameType: 'trap',
    desc: 'When an opponent\'s monster declares an attack: Destroy all your opponent\'s Attack Position monsters.',
    race: 'Normal',
    archetype: null,
    attribute: null,
    atk: null,
    def: null,
    level: null,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: { ban_goat: 'Limited' },
    cardPrices: null,
    tcgDate: '2002-06-26',
    ocgDate: '2000-01-27',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/mirror-force-3764',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.blueEyesUltimateDragon,
    name: 'Blue-Eyes Ultimate Dragon',
    type: 'Fusion Monster',
    frameType: 'fusion',
    desc: '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"',
    race: 'Dragon',
    archetype: 'Blue-Eyes',
    attribute: 'LIGHT',
    atk: 4500,
    def: 3800,
    level: 12,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2006-01-01',
    ocgDate: '1999-08-26',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/blue-eyes-ultimate-dragon-2067',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.stardustDragon,
    name: 'Stardust Dragon',
    type: 'Synchro Monster',
    frameType: 'synchro',
    desc: '1 Tuner + 1+ non-Tuner monsters\nWhen a card or effect is activated that would destroy a card(s) on the field (Quick Effect): You can Tribute this card; negate the activation, and if you do, destroy it. During the End Phase, if this effect was activated this turn (and was not negated): You can Special Summon this card from your GY.',
    race: 'Dragon',
    archetype: 'Stardust',
    attribute: 'WIND',
    atk: 2500,
    def: 2000,
    level: 8,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2008-09-02',
    ocgDate: '2008-04-19',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/stardust-dragon-3794',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.utopia,
    name: 'Number 39: Utopia',
    type: 'XYZ Monster',
    frameType: 'xyz',
    desc: '2 Level 4 monsters\nWhen a monster declares an attack: You can detach 1 material from this card; negate the attack. If this card is targeted for an attack, while it has no material: Destroy this card.',
    race: 'Warrior',
    archetype: 'Utopia',
    attribute: 'LIGHT',
    atk: 2500,
    def: 2000,
    level: 4,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2011-08-16',
    ocgDate: '2011-03-19',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/number-39-utopia-7046',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.decodeTalker,
    name: 'Decode Talker',
    type: 'Link Monster',
    frameType: 'link',
    desc: '2+ Effect Monsters\nGains 500 ATK for each monster it points to. When your opponent activates a card or effect that targets a card(s) you control (Quick Effect): You can Tribute 1 monster this card points to; negate the activation, and if you do, destroy that card.',
    race: 'Cyberse',
    archetype: 'Code Talker',
    attribute: 'DARK',
    atk: 2300,
    def: null,
    level: null,
    linkval: 3,
    scale: null,
    linkMarkers: ['Top', 'Bottom-Left', 'Bottom-Right'],
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2017-07-21',
    ocgDate: '2017-03-25',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/decode-talker-8433',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.oddEyesPendulumDragon,
    name: 'Odd-Eyes Pendulum Dragon',
    type: 'Pendulum Effect Monster',
    frameType: 'effect_pendulum',
    desc: '[ Pendulum Effect ]\nYou can reduce the battle damage you take from an attack involving a Pendulum Monster you control to 0. During your End Phase: You can destroy this card, and if you do, add 1 Pendulum Monster with 1500 or less ATK from your Deck to your hand. You can only use each Pendulum Effect of "Odd-Eyes Pendulum Dragon" once per turn.\n\n[ Monster Effect ]\nIf this card battles an opponent\'s monster, any battle damage this card inflicts to your opponent is doubled.',
    race: 'Dragon',
    archetype: '-Eyes Dragon',
    attribute: 'DARK',
    atk: 2500,
    def: 2000,
    level: 7,
    linkval: null,
    scale: 4,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2014-11-21',
    ocgDate: '2014-04-19',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/odd-eyes-pendulum-dragon-1388',
    syncedAt: SYNCED_AT,
  },
  {
    id: CATALOG_FIXTURE_IDS.effectVeiler,
    name: 'Effect Veiler',
    type: 'Tuner Monster',
    frameType: 'effect',
    desc: 'During your opponent\'s Main Phase (Quick Effect): You can send this card from your hand to the GY, then target 1 Effect Monster your opponent controls; negate the effects of that face-up monster your opponent controls, until the end of this turn.',
    race: 'Spellcaster',
    archetype: null,
    attribute: 'LIGHT',
    atk: 0,
    def: 0,
    level: 1,
    linkval: null,
    scale: null,
    linkMarkers: null,
    banlistInfo: null,
    cardPrices: null,
    tcgDate: '2010-08-07',
    ocgDate: '2010-04-17',
    ygoprodeckUrl: 'https://ygoprodeck.com/card/effect-veiler-8093',
    syncedAt: SYNCED_AT,
  },
]

export const CATALOG_FIXTURE_SETS: CatalogSetRow[] = [
  { id: 'starter-deck-yugi', name: 'Starter Deck: Yugi' },
  { id: 'legend-of-blue-eyes-white-dragon', name: 'Legend of Blue Eyes White Dragon' },
  { id: 'metal-raiders', name: 'Metal Raiders' },
  { id: 'legendary-duelists-season-2', name: 'Legendary Duelists: Season 2' },
  { id: 'the-duelist-genesis', name: 'The Duelist Genesis' },
  { id: 'starter-deck-dawn-of-the-xyz', name: 'Starter Deck: Dawn of the Xyz' },
  { id: 'starter-deck-link-strike', name: 'Starter Deck: Link Strike' },
  { id: 'duelist-alliance', name: 'Duelist Alliance' },
  { id: 'duel-devastator', name: 'Duel Devastator' },
]

export const CATALOG_FIXTURE_PRINTINGS: CatalogPrintingRow[] = [
  { id: 'SDY-006', cardId: CATALOG_FIXTURE_IDS.darkMagician, setId: 'starter-deck-yugi', setCode: 'SDY-006', rarity: 'Ultra Rare', price: '9.96' },
  { id: 'LOB-005', cardId: CATALOG_FIXTURE_IDS.darkMagician, setId: 'legend-of-blue-eyes-white-dragon', setCode: 'LOB-005', rarity: 'Ultra Rare', price: '46.71' },
  { id: 'LOB-001', cardId: CATALOG_FIXTURE_IDS.blueEyesWhiteDragon, setId: 'legend-of-blue-eyes-white-dragon', setCode: 'LOB-001', rarity: 'Ultra Rare', price: '62.15' },
  { id: 'MRD-003', cardId: CATALOG_FIXTURE_IDS.summonedSkull, setId: 'metal-raiders', setCode: 'MRD-003', rarity: 'Ultra Rare', price: '45.91' },
  { id: 'MRD-071', cardId: CATALOG_FIXTURE_IDS.kuriboh, setId: 'metal-raiders', setCode: 'MRD-071', rarity: 'Super Rare', price: '6.04' },
  { id: 'LOB-119', cardId: CATALOG_FIXTURE_IDS.potOfGreed, setId: 'legend-of-blue-eyes-white-dragon', setCode: 'LOB-119', rarity: 'Rare', price: '4.2' },
  { id: 'LOB-053', cardId: CATALOG_FIXTURE_IDS.raigeki, setId: 'legend-of-blue-eyes-white-dragon', setCode: 'LOB-053', rarity: 'Super Rare', price: '26.05' },
  { id: 'LOB-118', cardId: CATALOG_FIXTURE_IDS.monsterReborn, setId: 'legend-of-blue-eyes-white-dragon', setCode: 'LOB-118', rarity: 'Ultra Rare', price: '27.29' },
  { id: 'MRD-138', cardId: CATALOG_FIXTURE_IDS.mirrorForce, setId: 'metal-raiders', setCode: 'MRD-138', rarity: 'Ultra Rare', price: '15.47' },
  { id: 'LDS2-EN018', cardId: CATALOG_FIXTURE_IDS.blueEyesUltimateDragon, setId: 'legendary-duelists-season-2', setCode: 'LDS2-EN018', rarity: 'Ultra Rare', price: null },
  { id: 'TDGS-EN040', cardId: CATALOG_FIXTURE_IDS.stardustDragon, setId: 'the-duelist-genesis', setCode: 'TDGS-EN040', rarity: 'Ultra Rare', price: '31.54' },
  { id: 'YS11-EN041', cardId: CATALOG_FIXTURE_IDS.utopia, setId: 'starter-deck-dawn-of-the-xyz', setCode: 'YS11-EN041', rarity: 'Ultra Rare', price: '3.05' },
  { id: 'YS17-EN041', cardId: CATALOG_FIXTURE_IDS.decodeTalker, setId: 'starter-deck-link-strike', setCode: 'YS17-EN041', rarity: 'Ultra Rare', price: '1.47' },
  { id: 'DUEA-EN004', cardId: CATALOG_FIXTURE_IDS.oddEyesPendulumDragon, setId: 'duelist-alliance', setCode: 'DUEA-EN004', rarity: 'Secret Rare', price: '7.54' },
  { id: 'DUDE-EN028', cardId: CATALOG_FIXTURE_IDS.effectVeiler, setId: 'duel-devastator', setCode: 'DUDE-EN028', rarity: 'Ultra Rare', price: '5.91' },
]

export const CATALOG_FIXTURE_IMAGES: CatalogCardImageRow[] = Object.values(CATALOG_FIXTURE_IDS).map(id => ({
  id,
  cardId: id,
  ...imageUrls(id),
}))

/**
 * Upserts the fixture catalog into `db`, inside a single transaction, so
 * E2E and unit tests can rely on a small, deterministic card catalog
 * instead of depending on a full `catalog:sync` run. Idempotent — safe to
 * call multiple times (e.g. once per Playwright webServer boot).
 */
export function seedCatalogFixture(db: Db) {
  db.transaction((tx) => {
    for (const cardRow of CATALOG_FIXTURE_CARDS) {
      tx.insert(catalogCard)
        .values(cardRow)
        .onConflictDoUpdate({ target: catalogCard.id, set: cardRow })
        .run()
    }

    for (const set of CATALOG_FIXTURE_SETS) {
      tx.insert(catalogSet)
        .values(set)
        .onConflictDoUpdate({ target: catalogSet.id, set: { name: set.name } })
        .run()
    }

    for (const printing of CATALOG_FIXTURE_PRINTINGS) {
      tx.insert(catalogPrinting)
        .values(printing)
        .onConflictDoUpdate({ target: catalogPrinting.id, set: printing })
        .run()
    }

    for (const image of CATALOG_FIXTURE_IMAGES) {
      tx.insert(catalogCardImage)
        .values(image)
        .onConflictDoUpdate({ target: catalogCardImage.id, set: image })
        .run()
    }
  })
}
