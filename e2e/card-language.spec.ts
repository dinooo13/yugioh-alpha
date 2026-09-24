import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { registerAndLogin, trackHydrationWarnings } from './helpers/auth'
import { CARD, CARD_EN } from './helpers/cards'

// Card language (#34 F3c, ADR 0015): card names and texts follow the
// interface language unless the profile picks one, SSR renders the right
// names on the first load, and the detail shows the German text (without a
// source credit in the UI since #87; the README names the source).

async function searchCatalog(page: Page, query: string) {
  await page.goto('/catalog')
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/Karten suchen|Search cards/).fill(query)
}

/** Picks an option in the profile's "Kartensprache / Card language" select. */
async function pickCardLanguage(page: Page, label: 'Kartensprache' | 'Card language', option: string) {
  const saved = page.waitForResponse(response =>
    response.url().endsWith('/api/profile') && response.request().method() === 'PATCH')
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  expect((await saved).ok()).toBe(true)
}

test.describe('card language', () => {
  test('German interface: German card names by default, English once the profile says so', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await registerAndLogin(page)

    await searchCatalog(page, 'Dark Magician')
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()

    // The first server render already carries the German name.
    const html = await (await page.request.get('/catalog?q=Dark%20Magician')).text()
    expect(html).toContain(CARD.darkMagician)

    await page.goto('/profile')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('combobox', { name: 'Kartensprache' })).toContainText('Wie Anzeigesprache (Deutsch)')
    await pickCardLanguage(page, 'Kartensprache', 'Englisch')
    await expect(page.getByRole('combobox', { name: 'Kartensprache' })).toContainText('Englisch')

    // The interface stays German, the card names are English — also after a reload (SSR).
    await searchCatalog(page, 'Dunkler Magier')
    await expect(page.getByRole('heading', { name: CARD_EN.darkMagician })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toHaveCount(0)
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: CARD_EN.darkMagician })).toBeVisible()
    await expect(page.getByText('Katalog', { exact: true }).first()).toBeVisible()

    expect(warnings).toEqual([])
  })

  test('English interface with "follow": English card names', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await registerAndLogin(page)
    await page.request.patch('/api/profile', { data: { locale: 'en' } })

    await searchCatalog(page, 'Dunkler Magier')
    await expect(page.getByRole('heading', { name: CARD_EN.darkMagician })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toHaveCount(0)

    await page.goto('/profile')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('combobox', { name: 'Card language' })).toContainText('Same as interface (English)')

    // German card names in an English interface.
    await pickCardLanguage(page, 'Card language', 'German')
    await searchCatalog(page, 'Dark Magician')
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()

    expect(warnings).toEqual([])
  })

  test('the detail shows the German text and the English name, but no source credit; a card without German data stays English', async ({ page }) => {
    await registerAndLogin(page)

    await searchCatalog(page, 'Dark Magician')
    await page.getByRole('button', { name: CARD.darkMagician, exact: true }).click()

    const detail = page.getByRole('dialog')
    await expect(detail.getByRole('heading', { name: CARD.darkMagician, level: 3 })).toBeVisible()
    await expect(detail.getByText(`Englisch: ${CARD_EN.darkMagician}`)).toBeVisible()
    await expect(detail.getByText('Hexer', { exact: false }).first()).toBeVisible()
    await expect(detail.getByText('Deutsche Kartentexte')).toHaveCount(0)

    // Raigeki has no German data in the fixture: English name and text, and a hint.
    await searchCatalog(page, 'Raigeki')
    await page.getByRole('button', { name: CARD.raigeki, exact: true }).click()
    await expect(detail.getByRole('heading', { name: CARD.raigeki, level: 3 })).toBeVisible()
    await expect(detail.getByText('Für diese Karte gibt es keinen deutschen Kartentext.')).toBeVisible()
    await expect(detail.getByText('Englisch:', { exact: false })).toHaveCount(0)
  })

  test('card data labels follow the card language; filter values stay English (#34 F3d)', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await registerAndLogin(page)

    // German: the attribute filter offers "FINSTERNIS" and filters by DARK.
    await page.goto('/catalog')
    await page.waitForLoadState('networkidle')
    const attribute = page.getByRole('combobox', { name: 'Attribut' })
    await expect(attribute.locator('option', { hasText: 'FINSTERNIS' })).toHaveAttribute('value', 'DARK')
    await expect(attribute.locator('option', { hasText: /^DARK$/ })).toHaveCount(0)
    await attribute.selectOption({ label: 'FINSTERNIS' })
    await expect(page).toHaveURL(/attribute=DARK/)
    const tile = page.getByRole('article', { name: CARD.darkMagician, exact: true })
    await expect(tile.getByText('FINSTERNIS', { exact: true })).toBeVisible()
    await expect(tile.getByText('Normales Monster', { exact: true })).toBeVisible()

    // English interface, German cards: still German labels (also in the first server render).
    await page.request.patch('/api/profile', { data: { locale: 'en', cardLocale: 'de' } })
    await page.goto('/catalog?attribute=DARK')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('combobox', { name: 'Attribute' }).locator('option', { hasText: 'FINSTERNIS' })).toHaveAttribute('value', 'DARK')
    await expect(page.getByRole('article', { name: CARD.darkMagician, exact: true }).getByText('FINSTERNIS', { exact: true })).toBeVisible()

    // English cards: the stored values.
    await page.request.patch('/api/profile', { data: { cardLocale: 'en' } })
    await page.goto('/catalog?attribute=DARK')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('combobox', { name: 'Attribute' }).locator('option', { hasText: /^DARK$/ })).toHaveAttribute('value', 'DARK')
    const englishTile = page.getByRole('article', { name: CARD_EN.darkMagician, exact: true })
    await expect(englishTile.getByText('DARK', { exact: true })).toBeVisible()
    await expect(englishTile.getByText('Normal Monster', { exact: true })).toBeVisible()

    expect(warnings).toEqual([])
  })
})
