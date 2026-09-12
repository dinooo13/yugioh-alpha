import { expect, test } from '@playwright/test'
import { logout, registerAndLogin, uniqueEmail } from './helpers/auth'

test.describe('auth happy path', () => {
  test('register, logout, then login again', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'super-secret-123'

    // Register a new user.
    await registerAndLogin(page, { name: 'E2E Test User', email, password })

    // Better Auth signs the user in immediately after registration. The app
    // name now appears twice (desktop sidebar + mobile topbar, #1) — scope
    // to the desktop sidebar, which is what's actually visible at this
    // (desktop) viewport. The sidebar shows the registered name, not the
    // e-mail address (#17).
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByText('yugioh alpha', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()
    await expect(sidebar.getByText('E2E Test User')).toBeVisible()

    // Log out.
    await logout(page)

    // Log back in via the login form.
    await page.getByLabel('E-Mail').fill(email)
    await page.getByLabel('Passwort').fill(password)
    await page.getByRole('button', { name: 'Anmelden' }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()

    // Log out again to leave a clean state.
    await logout(page)
  })
})
