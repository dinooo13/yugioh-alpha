import { expect, test } from '@playwright/test'

function uniqueEmail() {
  return `e2e-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

test.describe('catalog route', () => {
  test('authenticated users can reach /katalog from the app nav', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'super-secret-123'

    await page.goto('/register')
    await page.getByLabel('Name').fill('Catalog E2E User')
    await page.getByLabel('E-Mail').fill(email)
    await page.getByLabel('Passwort').fill(password)
    await page.getByRole('button', { name: 'Registrieren' }).click()

    await expect(page).toHaveURL('/')
    await page.getByRole('link', { name: 'Katalog' }).click()

    await expect(page).toHaveURL('/katalog')
    await expect(page.getByRole('heading', { name: 'Katalog', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Katalog' })).toBeVisible()
    await expect(page.getByLabel('Karten suchen')).toBeVisible()
  })
})
