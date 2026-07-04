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
  misc_info: [{ tcg_date: '2002-03-08', ocg_date: '1999-02-04' }],
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
  misc_info: [{ tcg_date: '2002-03-08' }],
  ygoprodeck_url: 'https://ygoprodeck.com/card/pot-of-greed',
}
