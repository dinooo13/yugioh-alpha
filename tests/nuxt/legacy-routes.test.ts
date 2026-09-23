import { describe, expect, it } from 'vitest'
import { legacyRedirectTarget } from '../../shared/legacy-routes'

// German → English URL scheme (docs/adr/0013-english-url-scheme.md).
const REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  // Every page of the old scheme.
  ['/inventar', '/inventory'],
  ['/inventar/erfassen', '/inventory/quick-entry'],
  ['/katalog', '/catalog'],
  ['/assistent', '/assistant'],
  ['/assistent/0b6c7a44-6d0e-4c1c-9d0e-1f2a3b4c5d6e', '/assistant/0b6c7a44-6d0e-4c1c-9d0e-1f2a3b4c5d6e'],
  ['/formate', '/formats'],
  ['/formate/neu', '/formats/new'],
  ['/formate/f1', '/formats/f1'],
  ['/wunschliste', '/wishlist'],
  ['/turniere', '/tournaments'],
  ['/turniere/neu', '/tournaments/new'],
  ['/turniere/t1', '/tournaments/t1'],
  ['/profil', '/profile'],
  ['/spieler', '/players'],
  ['/spieler/dino', '/players/dino'],
  ['/spieler/dino/inventar', '/players/dino/inventory'],
  ['/spieler/dino/sammlungen/abc', '/players/dino/collections/abc'],
  ['/spieler/dino/decks/d1', '/players/dino/decks/d1'],
  // Share tokens pass through byte for byte.
  ['/spieler/dino/sammlungen/abc?token=Xy-_z', '/players/dino/collections/abc?token=Xy-_z'],
  ['/spieler/dino/decks/d1?token=Ab%2BCd_-9', '/players/dino/decks/d1?token=Ab%2BCd_-9'],
  ['/spieler/dino/inventar?token=Q-w_e', '/players/dino/inventory?token=Q-w_e'],
  // Trailing slash, case of fixed segments.
  ['/inventar/', '/inventory'],
  ['/Inventar/Erfassen', '/inventory/quick-entry'],
  ['/SPIELER/dino/Sammlungen/abc', '/players/dino/collections/abc'],
  // Dynamic segments are copied verbatim (no case folding, no decoding).
  ['/spieler/Dino-Fan/decks/D1', '/players/Dino-Fan/decks/D1'],
  ['/spieler/dino%2Dfan/sammlungen/a%20b', '/players/dino%2Dfan/collections/a%20b'],
  // A handle that looks like a German section is still just a handle.
  ['/spieler/inventar', '/players/inventar'],
  // Other query parameters pass through unchanged.
  ['/inventar/erfassen?collectionId=c1', '/inventory/quick-entry?collectionId=c1'],
  ['/assistent?deckId=d1', '/assistant?deckId=d1'],
  ['/assistent?intent=new-deck', '/assistant?intent=new-deck'],
  ['/assistent/c1?prompt=Hallo%20Welt', '/assistant/c1?prompt=Hallo%20Welt'],
  ['/katalog?card=42&q=Dunkler', '/catalog?card=42&q=Dunkler'],
  // Inventory view values.
  ['/inventar?view=uebersicht&collectionId=c1', '/inventory?view=overview&collectionId=c1'],
  ['/inventar?view=liste', '/inventory?view=list'],
  ['/inventar?collectionId=__none__', '/inventory?collectionId=__none__'],
  // The former one-shot deck builder: one hop straight to the chat.
  ['/decks/assistent', '/assistant?intent=new-deck'],
  ['/decks/assistent?intent=x', '/assistant?intent=x'],
  ['/Decks/Assistent', '/assistant?intent=new-deck'],
  // Dashboard "Deck anlegen".
  ['/decks?neu=1', '/decks?new=1'],
  // Fragments are kept; the old #wunschliste anchor is accepted as not scrolling.
  ['/profil#wunschliste', '/profile#wunschliste'],
  ['/spieler/dino/decks/d1?token=t#x', '/players/dino/decks/d1?token=t#x'],
]

const NOT_LEGACY = [
  '',
  '/',
  '/decks',
  '/decks/',
  '/decks/abc',
  '/decks?q=x',
  '/decks/abc?neu=1',
  '/login',
  '/login?redirect=/inventar',
  '/register',
  '/api/inventory',
  '/api/profile',
  '/_nuxt/x.js',
  '/spielerx',
  '/inventarliste',
  '/favicon.ico',
  // Every English path.
  '/inventory',
  '/inventory?view=overview',
  '/inventory/quick-entry',
  '/catalog',
  '/assistant',
  '/assistant/c1',
  '/formats',
  '/formats/new',
  '/formats/f1',
  '/wishlist',
  '/tournaments',
  '/tournaments/new',
  '/tournaments/t1',
  '/profile',
  '/players',
  '/players/dino',
  '/players/dino/inventory',
  '/players/dino/collections/abc?token=x',
  '/players/dino/decks/d1',
  '/decks?new=1',
]

describe('legacyRedirectTarget', () => {
  it.each(REDIRECTS)('%s → %s', (from, to) => {
    expect(legacyRedirectTarget(from)).toBe(to)
  })

  it.each(NOT_LEGACY)('leaves %j alone', (url) => {
    expect(legacyRedirectTarget(url)).toBeNull()
  })

  it('never maps its own output again (one hop, no chains)', () => {
    for (const [from] of REDIRECTS) {
      const to = legacyRedirectTarget(from)!
      expect(legacyRedirectTarget(to), `${from} → ${to}`).toBeNull()
    }
  })

  it('never produces a protocol-relative URL', () => {
    const tricky = [
      '/spieler//evil.com',
      '//spieler/evil.com',
      '/spieler//evil.com/decks/x',
      '/inventar//evil.com',
      '/decks//assistent',
      '/profil/%2F%2Fevil.com',
    ]
    for (const from of [...tricky, ...REDIRECTS.map(([f]) => f)]) {
      const to = legacyRedirectTarget(from)
      if (to === null) continue
      expect(to.startsWith('//'), `${from} → ${to}`).toBe(false)
      expect(to.startsWith('/'), `${from} → ${to}`).toBe(true)
    }
    expect(legacyRedirectTarget('/spieler//evil.com')).toBe('/players/evil.com')
  })
})
