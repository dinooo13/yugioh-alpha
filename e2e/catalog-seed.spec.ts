import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

test.describe('catalog seed', () => {
  test('search finds a seeded card', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/katalog')
    await page.getByLabel('Karten suchen').fill('Dark Magician')

    await expect(page.getByRole('heading', { name: 'Dark Magician' })).toBeVisible()
  })
})
