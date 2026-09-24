import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { CARD } from './helpers/cards'

test.describe('catalog seed', () => {
  test('search finds a seeded card', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await page.getByLabel('Karten suchen').fill('Dark Magician')

    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()
  })

  test('search finds a card by its German name (ADR 0015)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await page.getByLabel('Karten suchen').fill('Dunkler Magier')

    // Shown in the card language, which follows the German interface (F3c).
    await expect(page.getByRole('heading', { name: CARD.darkMagician })).toBeVisible()
    await expect(page.getByRole('heading', { name: CARD.potOfGreed })).toHaveCount(0)
  })
})
