import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'

// Passcode from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts) — the fixture has exactly one
// card whose name contains "Dark Magician", so every count/name assertion
// below is unambiguous.
const DARK_MAGICIAN = 46986414

// A minimal, genuinely decodable 1x1 transparent PNG — the composer resizes
// whatever is picked via `createImageBitmap` before sending it, so a fake
// byte string wouldn't survive that step; this has to be a real image.
const ONE_PIXEL_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.describe('Chat assistant', () => {
  test('searches the catalog, proposes and applies an inventory change, understands a photo, and manages conversations', async ({ page }) => {
    await registerAndLogin(page)

    // Seed one owned Dark Magician through the API (same session cookie as
    // the page) so "füge 2 hinzu" below lands on a total of 3, not 2.
    const seedResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 1 },
    })
    expect(seedResponse.ok()).toBe(true)

    await page.getByRole('link', { name: 'Assistent', exact: true }).click()
    await expect(page).toHaveURL('/assistent')

    // Fresh account: no conversations exist yet, so /assistent shows the
    // empty state — its primary "Neue Unterhaltung" button (not one of the
    // example prompts below it) creates an empty conversation and navigates
    // straight into it, with nothing auto-sent.
    await page.getByRole('button', { name: 'Neue Unterhaltung', exact: true }).click()
    await expect(page).toHaveURL(/\/assistent\/[0-9a-f-]+$/)

    const nachricht = page.getByLabel('Nachricht', { exact: true })
    const senden = page.getByRole('button', { name: 'Senden', exact: true })

    await expect(nachricht).toBeEnabled()

    // --- search_catalog ---------------------------------------------------
    await nachricht.fill('suche Dark Magician')
    await senden.click()

    await expect(page.getByText('Sucht im Katalog: Dark Magician')).toBeVisible()
    await expect(page.getByText('Ich habe 1 Karte gefunden: Dark Magician')).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- add_to_inventory proposal -----------------------------------------
    // Exactly one action card is ever visible in this conversation, so a
    // page-wide lookup for its status/buttons is unambiguous.
    await nachricht.fill('füge 2 hinzu')
    await senden.click()

    await expect(page.getByText('Karten ins Inventar aufnehmen')).toBeVisible()
    await expect(page.getByText('Wartet auf Bestätigung')).toBeVisible()
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click()
    await expect(page.getByText('Übernommen')).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- applied for real: 1 seeded + 2 proposed = 3 -----------------------
    await page.goto('/inventar')
    await page.getByRole('button', { name: 'Übersicht', exact: true }).click()
    await expect(page.getByText('Dark Magician').first()).toBeVisible()
    await expect(page.getByText('×3 ges.')).toBeVisible()

    // --- new conversation, image input --------------------------------------
    await page.goto('/assistent')
    // A conversation exists now, so this redirects into it — the aside with
    // the conversation list (and "Neue Unterhaltung") is only reachable from
    // inside a thread, not from the bare empty state.
    await expect(page).toHaveURL(/\/assistent\/[0-9a-f-]+$/)
    const firstConversationUrl = page.url()

    // The app layout has its own `<aside>` sidebar (nav + collections) —
    // scope to the one that actually holds the conversation list, rather
    // than assuming it's the only `<aside>` on the page.
    const conversationAside = page.locator('aside').filter({
      has: page.getByRole('button', { name: 'Neue Unterhaltung', exact: true }),
    })
    await conversationAside.getByRole('button', { name: 'Neue Unterhaltung', exact: true }).click()
    await expect(page).toHaveURL(/\/assistent\/[0-9a-f-]+$/)
    await expect(page).not.toHaveURL(firstConversationUrl)

    // Both the hidden `<input type="file">` and the visible button that
    // triggers it share the "Foto hinzufügen" accessible name — only the
    // input accepts `setInputFiles`.
    await page.locator('input[type="file"][aria-label="Foto hinzufügen"]').setInputFiles({
      name: 'karte.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
    })
    await expect(senden).toBeEnabled()
    await senden.click()

    await expect(page.getByText('Dark Magician', { exact: false }).first()).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- conversation list: title derived from the first message, delete ---
    // The first conversation's title comes from its first user message —
    // "suche Dark Magician", sent right after the empty conversation was created.
    const firstConversationItem = conversationAside.locator('li').filter({ hasText: 'suche Dark Magician' })
    await expect(firstConversationItem.getByRole('link', { name: 'suche Dark Magician', exact: true })).toBeVisible()

    await firstConversationItem.getByRole('button').click()
    await acceptConfirm(page)
    await expect(firstConversationItem).toHaveCount(0)
  })

  test('/inventar/erfassen points to the assistant instead of offering its own Foto/Sprache modes', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/inventar/erfassen')

    await expect(page.getByText('Karten per Foto? Nutze den Assistenten')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Foto' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Sprache' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Zum Assistenten', exact: true }).click()
    await expect(page).toHaveURL(/\/assistent/)
  })
})
