import { expect, test } from '@playwright/test'

test.describe('protected routes', () => {
  test('visiting the dashboard unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /inventar unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/inventar')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })
})
