import { expect, test, type Locator } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

// Card data in lists and the overlay (#148, ADR 0025): a `?` ATK/DEF, the
// Pendulum scale, the primary artwork and Link ratings on catalog tiles, and
// format ATK ranges that never match a `?`.

// Passcodes from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const TEN_THOUSAND_DRAGON = 10000
const ODD_EYES = 16178683
const ODD_EYES_OLD_ARTWORK = 16178681
const DARK_MAGICIAN = 46986414

/** The value next to a `<dt>` term in the overlay's stat box. */
function stat(dialog: Locator, term: string): Locator {
  return dialog.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]')
}

test.describe('card data', () => {
  test('the overlay shows a "?" ATK/DEF as "?"', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${TEN_THOUSAND_DRAGON}`)
    await waitForHydration(page)

    const detail = page.getByRole('dialog', { name: CARD.tenThousandDragon })
    await expect(detail).toBeVisible()
    await expect(stat(detail, 'ATK')).toHaveText('?')
    await expect(stat(detail, 'DEF')).toHaveText('?')
    await expect(detail.getByText('-1', { exact: true })).toHaveCount(0)
  })

  test('the overlay shows a Pendulum monster\'s scale', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${ODD_EYES}`)
    await waitForHydration(page)

    const detail = page.getByRole('dialog', { name: CARD.oddEyesPendulumDragon })
    await expect(detail).toBeVisible()
    await expect(stat(detail, 'Pendelbereich')).toHaveText('4')
  })

  test('catalog tiles show the card\'s own artwork and a Link rating', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await waitForHydration(page)

    // Odd-Eyes' lower old-passcode artwork no longer wins over its own-id image.
    let searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Odd-Eyes'))
    await page.getByLabel('Karten suchen').fill('Odd-Eyes')
    await searched
    const oddEyes = page.getByLabel(CARD.oddEyesPendulumDragon, { exact: true })
    await expect(oddEyes.locator('img').first()).toHaveAttribute('src', new RegExp(`/${ODD_EYES}\\.jpg$`))
    await expect(oddEyes.locator(`img[src*="${ODD_EYES_OLD_ARTWORK}"]`)).toHaveCount(0)

    searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Decode'))
    await page.getByLabel('Karten suchen').fill('Decode')
    await searched
    await expect(page.getByLabel(CARD.decodeTalker, { exact: true })).toContainText('Link 3')
  })

  test('a format ATK range never matches a "?" ATK (#140)', async ({ page }) => {
    await registerAndLogin(page)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Fragezeichen',
        cards: [
          { catalog_card_id: TEN_THOUSAND_DRAGON, section: 'main', quantity: 1 },
          { catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 1 },
        ],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json() as { id: string }

    const validateResponse = await page.request.post('/api/formats/validate', {
      data: {
        deckId: deck.id,
        rules: { rules: [{ kind: 'filter', match: 'matching', maxCopies: 0, filter: { atkMax: 3000 } }] },
      },
    })
    expect(validateResponse.ok()).toBe(true)
    const { validation } = await validateResponse.json() as { validation: { cards: Record<string, { status: string }> } }

    expect(validation.cards[DARK_MAGICIAN]?.status).toBe('forbidden')
    expect(validation.cards[TEN_THOUSAND_DRAGON]?.status).toBe('unrestricted')
  })
})
