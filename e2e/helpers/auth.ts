import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { E2E_INVITE_CODE } from './invite-code'

/** Generates a unique, valid email so parallel/repeat E2E runs never collide on a registered user. */
export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

export interface RegisterAndLoginOptions {
  name?: string
  email?: string
  password?: string
  /** Defaults to the E2E server's invite code (playwright.config.ts). */
  inviteCode?: string
}

export interface RegisteredUser {
  name: string
  email: string
  password: string
}

/**
 * Resolves once Nuxt has finished hydrating the current document (`nuxtApp.isHydrating` is false,
 * set right before `app:suspense:resolve` in nuxt/dist/app/nuxt.js). Before that, text typed into a
 * server-rendered input stays in the DOM but never reaches `v-model` (a submit sees empty fields), and
 * buttons have no handlers yet. Call it after every full page load (`goto`, `reload`, an `external`
 * navigateTo) and before the first `fill`/click that relies on Vue.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    type NuxtRoot = Element & { __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating?: boolean } } } } }
    const nuxtApp = (document.querySelector('#__nuxt') as NuxtRoot | null)?.__vue_app__?.config.globalProperties.$nuxt
    return nuxtApp !== undefined && nuxtApp.isHydrating === false
  })
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
  // Typing before hydration is lost ("Bitte fülle alle Felder aus.").
  await waitForHydration(page)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByLabel('Einladungscode').fill(options.inviteCode ?? E2E_INVITE_CODE)
  await page.getByRole('button', { name: 'Registrieren' }).click()

  await expect(page).toHaveURL('/')
  // `/` is reached by a full page load (`navigateTo(..., { external: true })`).
  await waitForHydration(page)

  return { name, email, password }
}

/**
 * Logs the current user out via the header "Abmelden" button, asserts landing on `/login`
 * and waits for that page (a full page load) to hydrate.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL('/login')
  await waitForHydration(page)
}

export interface LoginCredentials {
  email: string
  password: string
}

/**
 * Signs in through the `/login` form. Expects the page to already show the
 * login form (e.g. after `logout()` or a redirect to `/login?redirect=...`),
 * so a `redirect` query survives. Waits for the form to hydrate before typing.
 * Does not wait for the target page; callers assert the landing URL themselves.
 */
export async function loginViaForm(page: Page, { email, password }: LoginCredentials): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await waitForHydration(page)
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
