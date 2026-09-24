import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

test.describe('catalog seed', () => {
  test('search finds a seeded card', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await page.getByLabel('Karten suchen').fill('Dark Magician')

    await expect(page.getByRole('heading', { name: 'Dark Magician' })).toBeVisible()
  })

  test('search finds a card by its German name (ADR 0015)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await page.getByLabel('Karten suchen').fill('Dunkler Magier')

    // Still displayed in English until the card language arrives (F3c).
    await expect(page.getByRole('heading', { name: 'Dark Magician' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pot of Greed' })).toHaveCount(0)
  })
})
