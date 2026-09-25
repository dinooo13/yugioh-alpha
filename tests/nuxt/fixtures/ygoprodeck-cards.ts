import type { YgoproCard } from '../../../server/utils/ygoprodeck'

export const darkMagicianFixture: YgoproCard = {
  id: 46986414,
  name: 'Dark Magician',
  type: 'Normal Monster',
  frameType: 'normal',
  desc: 'The ultimate wizard in terms of attack and defense.',
  race: 'Spellcaster',
  attribute: 'DARK',
  atk: 2500,
  def: 2100,
  level: 7,
  linkmarkers: undefined,
  banlist_info: { ban_tcg: 'Limited' },
  card_prices: [{ cardmarket_price: '1.23' }],
  card_sets: [
    {
      set_name: 'Legend of Blue Eyes White Dragon',
      set_code: 'LOB-005',
      set_rarity: 'Ultra Rare',
      set_price: '5.00',
    },
    {
      set_name: 'Dark Magician Structure Deck',
      set_code: 'SDY-006',
      set_rarity: 'Common',
      set_price: '2.00',
    },
  ],
  card_images: [
    {
      id: 46986414,
      image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
      image_url_small: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg',
      image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg',
    },
  ],
  misc_info: [{ tcg_date: '2002-03-08', ocg_date: '1999-02-04', konami_id: 4041 }],
  ygoprodeck_url: 'https://ygoprodeck.com/card/dark-magician-58',
}

export const potOfGreedFixture: YgoproCard = {
  id: 55144522,
  name: 'Pot of Greed',
  type: 'Spell Card',
  frameType: 'spell',
  desc: 'Draw 2 cards.',
  race: 'Normal',
  card_prices: [{ cardmarket_price: '0.50' }],
  card_sets: [
    {
      set_name: 'Legend of Blue Eyes White Dragon',
      set_code: 'LOB-119',
      set_rarity: 'Common',
      set_price: '0.30',
    },
  ],
  card_images: [
    {
      id: 55144522,
      image_url: 'https://images.ygoprodeck.com/images/cards/55144522.jpg',
      image_url_small: 'https://images.ygoprodeck.com/images/cards_small/55144522.jpg',
      image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/55144522.jpg',
    },
  ],
  misc_info: [{ tcg_date: '2002-03-08', konami_id: 4844 }],
  ygoprodeck_url: 'https://ygoprodeck.com/card/pot-of-greed',
}

// Retired catalog cards (ADR 0019): rows YGOPRODeck dropped or renumbered.

function simpleCard(
  id: number,
  name: string,
  type: string,
  extra: Partial<YgoproCard> = {},
): YgoproCard {
  return {
    id,
    name,
    type,
    desc: `${name} text.`,
    card_images: [{ id, image_url: `https://images.ygoprodeck.com/images/cards/${id}.jpg` }],
    ...extra,
  }
}

/** Odd-Eyes Pendulum Dragon's old passcode; no Konami id (it left before the API sent one). */
export const oddEyesStaleFixture = simpleCard(16178681, 'Odd-Eyes Pendulum Dragon', 'Pendulum Effect Monster')
/** Odd-Eyes Pendulum Dragon's current passcode. */
export const oddEyesFixture = simpleCard(16178683, 'Odd-Eyes Pendulum Dragon', 'Pendulum Effect Monster', {
  misc_info: [{ konami_id: 11213 }],
})
/** A pre-release placeholder passcode, with the Konami id of the real card. */
export const placeholderFixture = simpleCard(101402024, 'Adamancipator Conductor', 'Tuner Monster', {
  misc_info: [{ konami_id: 23346 }],
})
export const placeholderRealFixture = simpleCard(24925387, 'Adamancipator Conductor', 'Tuner Monster', {
  misc_info: [{ konami_id: 23346 }],
})
/** A placeholder whose name YGOPRODeck stored with an HTML entity. */
export const entityNameStaleFixture = simpleCard(101402053, 'Graceful &amp; Skull Dice', 'Spell Card')
export const entityNameFixture = simpleCard(76630812, 'Graceful & Skull Dice', 'Spell Card')
/** A placeholder renamed at release: no replacement can be found. */
export const droppedFixture = simpleCard(101402013, 'Leviathan of Atlantis - Daedalus', 'Effect Monster')

/**
 * Dark Magician renumbered (#113): the card moves to 46986420 with the same
 * Konami id, and the old passcode stays as one of its artworks, the way
 * YGOPRODeck lists it today.
 */
export const darkMagicianRenumberedFixture: YgoproCard = {
  ...darkMagicianFixture,
  id: 46986420,
  card_images: [
    ...darkMagicianFixture.card_images!,
    {
      id: 46986420,
      image_url: 'https://images.ygoprodeck.com/images/cards/46986420.jpg',
      image_url_small: 'https://images.ygoprodeck.com/images/cards_small/46986420.jpg',
      image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986420.jpg',
    },
  ],
}
