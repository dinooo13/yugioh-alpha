import { expect, test } from '@playwright/test'
import { loginViaForm, registerAndLogin, waitForHydration } from './helpers/auth'

// A session that ends while the user stays on one page (#148): filters and
// overlays don't re-check the session, so the page's next API call answers
// 401 and sends the user to /login, and back to the page after signing in.

test('an API 401 on a protected page goes to /login and back (#148)', async ({ page, context }) => {
  const user = await registerAndLogin(page)

  await page.goto('/inventory')
  await waitForHydration(page)

  // The session ends elsewhere (expired, or signed out in another tab).
  await context.clearCookies()

  await page.getByRole('checkbox', { name: 'Auch im Kartentext suchen' }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/inventory?inText=1')

  await loginViaForm(page, user)
  await expect(page).toHaveURL('/inventory?inText=1')
  await expect(page.getByRole('checkbox', { name: 'Auch im Kartentext suchen' })).toBeChecked()
})
