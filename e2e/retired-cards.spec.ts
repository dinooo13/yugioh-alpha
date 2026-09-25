import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { logout, registerAndLogin, waitForHydration } from './helpers/auth'

// Retired catalog cards (ADR 0019) and printed passcodes (ADR 0023), on the
// rows the seeded E2E catalog fixture carries
// (server/db/fixtures/catalog-fixture.ts).
const ODD_EYES_OLD = 16178681 // retired → 16178683
const ODD_EYES = 16178683
const LEVIATHAN = 101402013 // retired, no replacement
const DARK_MAGICIAN = 46986414
const DARK_MAGICIAN_ARTWORK = 46986420 // an alternate artwork of Dark Magician

const RETIRED_HINT_PUBLIC = 'YGOPRODeck führt diese Karte nicht mehr, deshalb taucht sie in der Suche nicht mehr auf.'

async function createDeckWithRetiredCard(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/decks', {
    data: {
      name,
      cards: [
        { catalog_card_id: LEVIATHAN, section: 'main', quantity: 1 },
        { catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 },
      ],
    },
  })
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  // With a format: its validation replaces the "usual size" hints.
  const format = await page.request.patch(`/api/decks/${id}`, { data: { format_id: 'unlimited' } })
  expect(format.ok()).toBe(true)
  return id
}

test.describe('retired catalog cards', () => {
  test('the overlay of a retired card links to the current card (#108)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${ODD_EYES_OLD}`)
    await waitForHydration(page)

    const dialog = page.getByRole('dialog')
    const alert = dialog.getByTestId('card-retired-alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Nicht mehr im Katalog')
    await expect(alert).toContainText('unter einer neuen Nummer')

    await alert.getByRole('link', { name: 'Aktuelle Karte anzeigen' }).click()
    await expect(page).toHaveURL(new RegExp(`card=${ODD_EYES}`))
    await expect(page.getByRole('dialog', { name: 'Buntäugiger Pendeldrache' })).toBeVisible()
    await expect(page.getByTestId('card-retired-alert')).toHaveCount(0)
  })

  test('an alternate-artwork passcode opens its card and the URL names the card (#113)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${DARK_MAGICIAN_ARTWORK}`)
    await waitForHydration(page)

    await expect(page.getByRole('dialog', { name: 'Dunkler Magier' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`card=${DARK_MAGICIAN}(&|$)`))
    await expect(page.getByTestId('card-retired-alert')).toHaveCount(0)
  })

  test('the deck editor warns about a retired card, with a format too (#109)', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeckWithRetiredCard(page, 'Mit alter Karte')

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)

    await expect(page.getByText('Leviathan of Atlantis - Daedalus ist nicht mehr im Katalog', { exact: false })).toBeVisible()
    // The format validates the deck: the "usual size" hints stay hidden.
    await expect(page.getByText('sind üblich', { exact: false })).toHaveCount(0)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('a tap opens the retired hint, Escape closes it (#107)', async ({ page }) => {
      await registerAndLogin(page)
      const deckId = await createDeckWithRetiredCard(page, 'Touch')

      await page.goto(`/decks/${deckId}`)
      await waitForHydration(page)

      const badge = page.getByTestId('card-retired-badge').first()
      await expect(badge).toHaveText('Nicht mehr im Katalog')
      await badge.tap()
      const hint = page.getByTestId('card-retired-hint')
      await expect(hint).toBeVisible()
      await expect(hint).toContainText('Deine Einträge bleiben erhalten')
      // The tap hit the badge, not the row's card overlay underneath.
      await expect(page.getByRole('dialog', { name: /Leviathan/ })).toHaveCount(0)

      await page.keyboard.press('Escape')
      await expect(hint).toBeHidden()
    })
  })

  test('a shared deck marks the retired card for visitors (#108)', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeckWithRetiredCard(page, 'Geteilt mit alter Karte')
    const profile = await (await page.request.get('/api/profile')).json()
    const share = await page.request.put(`/api/sharing/deck/${deckId}`, { data: { visibility: 'link' } })
    expect(share.ok()).toBe(true)
    const { shareToken } = await share.json()

    await logout(page)
    await page.goto(`/players/${profile.handle}/decks/${deckId}?token=${shareToken}`)
    await waitForHydration(page)

    await expect(page.getByRole('heading', { name: 'Geteilt mit alter Karte' })).toBeVisible()
    const row = page.getByRole('listitem').filter({ hasText: 'Leviathan of Atlantis - Daedalus' })
    const badge = row.getByTestId('card-retired-badge')
    await expect(badge).toBeVisible()
    await badge.click()
    await expect(page.getByTestId('card-retired-hint')).toHaveText(RETIRED_HINT_PUBLIC)
  })
})
