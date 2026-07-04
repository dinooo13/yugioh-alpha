import { expect, test } from '@playwright/test'

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

test.describe('auth happy path', () => {
  test('register, logout, then login again', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'super-secret-123'

    // Register a new user.
    await page.goto('/register')
    await page.getByLabel('Name').fill('E2E Test User')
    await page.getByLabel('E-Mail').fill(email)
    await page.getByLabel('Passwort').fill(password)
    await page.getByRole('button', { name: 'Registrieren' }).click()

    // Better Auth signs the user in immediately after registration.
    await expect(page).toHaveURL('/')
    await expect(page.getByText('yugioh alpha', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    // Log out.
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await expect(page).toHaveURL('/login')

    // Log back in via the login form.
    await page.getByLabel('E-Mail').fill(email)
    await page.getByLabel('Passwort').fill(password)
    await page.getByRole('button', { name: 'Anmelden' }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()

    // Log out again to leave a clean state.
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await expect(page).toHaveURL('/login')
  })
})
