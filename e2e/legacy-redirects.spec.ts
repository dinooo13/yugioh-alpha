import { expect, test } from '@playwright/test'
import { logout, registerAndLogin } from './helpers/auth'
import { CARD } from './helpers/cards'

// German → English URL scheme (docs/adr/0013-english-url-scheme.md): every
// old URL answers with one permanent, uncached redirect to its new one.

// Passcode from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

const REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ['/inventar', '/inventory'],
  ['/inventar/erfassen', '/inventory/quick-entry'],
  ['/inventar?view=uebersicht&collectionId=x', '/inventory?view=overview&collectionId=x'],
  ['/katalog', '/catalog'],
  ['/katalog?card=46986414', '/catalog?card=46986414'],
  ['/assistent', '/assistant'],
  ['/assistent/abc', '/assistant/abc'],
  ['/decks/assistent', '/assistant?intent=new-deck'],
  ['/decks?neu=1', '/decks?new=1'],
  ['/formate', '/formats'],
  ['/formate/neu', '/formats/new'],
  ['/wunschliste', '/wishlist'],
  ['/turniere', '/tournaments'],
  ['/turniere/neu', '/tournaments/new'],
  ['/profil', '/profile'],
  ['/spieler', '/players'],
  ['/spieler/dino', '/players/dino'],
  ['/spieler/dino/inventar?token=Xy-_z', '/players/dino/inventory?token=Xy-_z'],
  ['/spieler/dino/sammlungen/abc?token=Xy-_z', '/players/dino/collections/abc?token=Xy-_z'],
  ['/spieler/dino/decks/abc?token=Xy-_z', '/players/dino/decks/abc?token=Xy-_z'],
]

test.describe('legacy German URLs', () => {
  for (const [from, to] of REDIRECTS) {
    test(`${from} redirects 301 to ${to}`, async ({ request }) => {
      const response = await request.get(from, { maxRedirects: 0 })
      expect(response.status()).toBe(301)
      expect(response.headers().location).toBe(to)
      expect(response.headers()['cache-control']).toContain('no-store')
    })
  }

  test('English and unrelated paths are not redirected', async ({ request }) => {
    for (const path of ['/login', '/players/gibt-es-nicht', '/api/assistant/status']) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status(), path).not.toBe(301)
    }
  })

  test('an old /spieler share link for a deck and a collection opens anonymously', async ({ page }) => {
    await registerAndLogin(page)
    const profile = await (await page.request.get('/api/profile')).json()

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Altes Link-Deck',
        cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json()
    const deckShare = await (await page.request.put(`/api/sharing/deck/${deck.id}`, {
      data: { visibility: 'link' },
    })).json()
    expect(deckShare.shareToken).toBeTruthy()

    const collectionResponse = await page.request.post('/api/collections', {
      data: { name: 'Alte Link-Box' },
    })
    expect(collectionResponse.ok()).toBe(true)
    const collection = await collectionResponse.json()
    const collectionShare = await (await page.request.put(`/api/sharing/collection/${collection.id}`, {
      data: { visibility: 'link' },
    })).json()
    expect(collectionShare.shareToken).toBeTruthy()

    await logout(page)

    // A link handed out before the rename.
    await page.goto(`/spieler/${profile.handle}/decks/${deck.id}?token=${deckShare.shareToken}`)
    await expect(page).toHaveURL(`/players/${profile.handle}/decks/${deck.id}?token=${deckShare.shareToken}`)
    await expect(page.getByRole('heading', { name: 'Altes Link-Deck' })).toBeVisible()
    await expect(page.getByText(CARD.darkMagician)).toBeVisible()

    await page.goto(`/spieler/${profile.handle}/sammlungen/${collection.id}?token=${collectionShare.shareToken}`)
    await expect(page).toHaveURL(`/players/${profile.handle}/collections/${collection.id}?token=${collectionShare.shareToken}`)
    await expect(page.getByRole('heading', { name: /Sammlung „Alte Link-Box“/ })).toBeVisible()
  })

  test('an old protected path ends at /login with the new path as redirect', async ({ page }) => {
    await page.goto('/inventar/erfassen')
    await expect(page).toHaveURL('/login?redirect=/inventory/quick-entry')
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })
})
