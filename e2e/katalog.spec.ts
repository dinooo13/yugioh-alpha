import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function uniqueEmail() {
  return `e2e-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

async function registerUser(page: Page) {
  const email = uniqueEmail()
  const password = 'super-secret-123'

  await page.goto('/register')
  await page.getByLabel('Name').fill('Catalog E2E User')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Registrieren' }).click()
  await expect(page).toHaveURL('/')

  return email
}

test.describe('catalog route', () => {
  test('authenticated users can reach /katalog from the app nav', async ({ page }) => {
    const hydrationMessages: string[] = []

    page.on('console', (message) => {
      if (
        ['error', 'warning'].includes(message.type())
        && /hydration|mismatch/i.test(message.text())
      ) {
        hydrationMessages.push(message.text())
      }
    })

    await registerUser(page)
    await page.getByRole('link', { name: 'Katalog' }).click()

    await expect(page).toHaveURL('/katalog')
    await expect(page.getByRole('heading', { name: 'Katalog', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Katalog' })).toBeVisible()
    await expect(page.getByLabel('Karten suchen')).toBeVisible()
    expect(hydrationMessages).toEqual([])
  })

  test('catalog layout fits a 390px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerUser(page)

    await page.goto('/katalog')
    await expect(page.getByRole('heading', { name: 'Katalog', exact: true })).toBeVisible()
    await expect(page.getByLabel('Karten suchen')).toBeVisible()

    const viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))

    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth)
  })
})
