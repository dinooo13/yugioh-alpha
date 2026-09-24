// `de/<konamiId>.json` files as the ygoresources card-history repo ships
// them (trimmed to the fields the sync reads plus a few it ignores).

export const deDarkMagician = {
  id: 4041,
  type: 'monster',
  name: 'Dunkler Magier',
  englishAttribute: 'dark',
  localizedAttribute: 'FINSTERNIS',
  effectText: 'Der ultimative Hexer im Hinblick auf Angriff und Verteidigung.',
  level: 7,
  atk: 2500,
  def: 2100,
  properties: ['Hexer', 'Normal'],
}

export const deBlueEyesWhiteDragon = {
  id: 4007,
  type: 'monster',
  name: 'Blauäugiger w. Drache',
  englishAttribute: 'light',
  localizedAttribute: 'LICHT',
  effectText: 'Dieser legendäre Drache ist eine mächtige Zerstörungsmaschine.\r\nEr ist buchstäblich unbesiegbar.',
  level: 8,
  atk: 3000,
  def: 2500,
  properties: ['Drache', 'Normal'],
}

export const deOddEyesPendulumDragon = {
  id: 11213,
  type: 'monster',
  name: 'Buntäugiger Pendeldrache',
  englishAttribute: 'dark',
  localizedAttribute: 'FINSTERNIS',
  effectText: 'Falls diese Karte gegen ein Monster eines Gegners kämpft, wird der Kampfschaden verdoppelt, den diese Karte deinem Gegner zufügt.',
  pendEffect: 'Du kannst den Kampfschaden, den du aus einem Angriff erhältst, an dem ein Pendelmonster beteiligt ist, das du kontrollierst, auf 0 reduzieren. Während deiner End Phase: Du kannst diese Karte zerstören und falls du dies tust, füge deiner Hand 1 Pendelmonster mit 1500 oder weniger ATK von deinem Deck hinzu. Du kannst jeden Pendeleffekt von „Buntäugiger Pendeldrache“ nur einmal pro Spielzug verwenden.',
  pendScale: 4,
  level: 7,
  atk: 2500,
  def: 2000,
  properties: ['Drache', 'Pendel', 'Effekt'],
}

/** A Konami id no catalog card has (an OCG-only card, say). */
export const deUnmapped = {
  id: 99999,
  type: 'spell',
  name: 'Nur im OCG',
  englishAttribute: 'spell',
  localizedAttribute: 'ZAUBER',
  effectText: 'Ziehe 1 Karte.',
}

/** Konami id → file content, ready for `buildTarGz` under `de/`. */
export function deFiles(overrides: Record<number, string | null> = {}): Record<string, string> {
  const files: Record<number, string | null> = {
    4041: JSON.stringify(deDarkMagician),
    4007: JSON.stringify(deBlueEyesWhiteDragon),
    11213: JSON.stringify(deOddEyesPendulumDragon),
    99999: JSON.stringify(deUnmapped),
    // Not card JSON: counted as invalid and skipped.
    12345: '{ "id": 12345, "name": ',
    ...overrides,
  }
  return Object.fromEntries(
    Object.entries(files)
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([id, content]) => [`de/${id}.json`, content]),
  )
}
