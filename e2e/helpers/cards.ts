/**
 * How the E2E catalog fixture's cards (server/db/fixtures/catalog-fixture.ts)
 * are shown. The E2E browser runs in German and the card language follows
 * the interface language (ADR 0015), so the UI shows the official German
 * names. Raigeki has no German data in the fixture (the fallback case) and
 * stays English — its German name would be the same anyway.
 *
 * Typed searches may use either name: search is bilingual.
 */
export const CARD = {
  darkMagician: 'Dunkler Magier',
  blueEyesWhiteDragon: 'Blauäugiger w. Drache',
  summonedSkull: 'Herbeigerufener Totenkopf',
  kuriboh: 'Kuriboh',
  potOfGreed: 'Topf der Gier',
  raigeki: 'Raigeki',
  monsterReborn: 'Wiedergeburt',
  mirrorForce: 'Spiegelkraft',
  blueEyesUltimateDragon: 'Blauäugiger ultimativer Drache',
  stardustDragon: 'Sternenstaubdrache',
  utopia: 'Nummer 39: Utopia',
  decodeTalker: 'Dekodier-Sprecher',
  oddEyesPendulumDragon: 'Buntäugiger Pendeldrache',
  effectVeiler: 'Effektverschleierin',
} as const

/** The same cards' English names — shown in an English interface or with the card language "Englisch". */
export const CARD_EN = {
  darkMagician: 'Dark Magician',
  blueEyesWhiteDragon: 'Blue-Eyes White Dragon',
  summonedSkull: 'Summoned Skull',
  kuriboh: 'Kuriboh',
  potOfGreed: 'Pot of Greed',
  raigeki: 'Raigeki',
  monsterReborn: 'Monster Reborn',
  mirrorForce: 'Mirror Force',
  blueEyesUltimateDragon: 'Blue-Eyes Ultimate Dragon',
  stardustDragon: 'Stardust Dragon',
  utopia: 'Number 39: Utopia',
  decodeTalker: 'Decode Talker',
  oddEyesPendulumDragon: 'Odd-Eyes Pendulum Dragon',
  effectVeiler: 'Effect Veiler',
} as const satisfies Record<keyof typeof CARD, string>
