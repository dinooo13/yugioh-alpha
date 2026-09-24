import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

test.describe('catalog seed', () => {
  test('search finds a seeded card', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await waitForHydration(page)
    await page.getByLabel('Karten suchen').fill('Dark Magician')

    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()
  })

  test('search finds a card by its German name (ADR 0015)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await waitForHydration(page)
    await page.getByLabel('Karten suchen').fill('Dunkler Magier')

    // Shown in the card language, which follows the German interface (F3c).
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.potOfGreed })).toHaveCount(0)
  })

  test('filters: multi-select type/attribute/level, URL state, sort and reset (#63)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await waitForHydration(page)

    // Multi-select menus stay open after a pick; Escape closes them.
    const attribute = page.getByRole('button', { name: 'Attribut', exact: true })
    await attribute.click()
    await page.getByRole('option', { name: 'FINSTERNIS', exact: true }).click()
    await page.getByRole('option', { name: 'WIND', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/attribute=DARK(%2C|,)WIND/)
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.stardustDragon })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.blueEyesWhiteDragon })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: CARD.potOfGreed })).toHaveCount(0)

    // DARK or WIND, and level 8: only Stardust Dragon (Dark Magician is level 7).
    await page.getByRole('button', { name: 'Level', exact: true }).click()
    await page.getByRole('option', { name: 'Level 8', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/level=8/)
    await expect(page.getByRole('heading', { name: CARD.stardustDragon })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toHaveCount(0)

    // The selection lives in the URL and survives a reload.
    await page.reload()
    await waitForHydration(page)
    await expect(attribute).toContainText('FINSTERNIS')
    await expect(page.getByRole('heading', { name: CARD.stardustDragon })).toBeVisible()

    // The sort is a plain select (combobox).
    await page.getByRole('combobox', { name: 'Sortierung' }).click()
    await page.getByRole('option', { name: 'Name Z-A' }).click()
    await expect(page).toHaveURL(/sort=-name/)

    // Reset clears the facets and the sort.
    await page.getByRole('button', { name: 'Zurücksetzen' }).click()
    await expect(page).not.toHaveURL(/attribute=|level=|sort=/)
    await expect(attribute).toHaveText('Attribut')
  })
})
