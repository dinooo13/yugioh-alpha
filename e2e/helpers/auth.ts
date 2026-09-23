import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Generates a unique, valid email so parallel/repeat E2E runs never collide on a registered user. */
export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

export interface RegisterAndLoginOptions {
  name?: string
  email?: string
  password?: string
}

export interface RegisteredUser {
  name: string
  email: string
  password: string
}

/**
 * Registers a fresh user via the `/register` UI and asserts it lands on `/`
 * (Better Auth signs the user in immediately after registration). Returns
 * the credentials used, so callers can log back in later in the same test.
 */
export async function registerAndLogin(page: Page, options: RegisterAndLoginOptions = {}): Promise<RegisteredUser> {
  const email = options.email ?? uniqueEmail()
  const name = options.name ?? 'E2E Test User'
  const password = options.password ?? 'super-secret-123'

  await page.goto('/register')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Registrieren' }).click()

  await expect(page).toHaveURL('/')

  return { name, email, password }
}

/** Logs the current user out via the header "Abmelden" button and asserts landing on `/login`. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL('/login')
}

export interface LoginCredentials {
  email: string
  password: string
}

/**
 * Signs in through the `/login` form. Expects the page to already show the
 * login form (e.g. after `logout()` or a redirect to `/login?redirect=...`),
 * so a `redirect` query survives. Does not wait for the target page; callers
 * assert the landing URL themselves.
 */
export async function loginViaForm(page: Page, { email, password }: LoginCredentials): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
}

/**
 * Collects Vue hydration warnings and errors from the console and from
 * uncaught page errors. Dev builds log "[Vue warn]: Hydration node mismatch
 * ..."; prod builds only log "Hydration completed but contains mismatches.".
 * Returns the live array, so assert on it at the end of the test.
 */
export function trackHydrationWarnings(page: Page): string[] {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (/hydration/i.test(message.text())) {
      warnings.push(`[${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    if (/hydration/i.test(error.message)) {
      warnings.push(`[pageerror] ${error.message}`)
    }
  })
  return warnings
}
