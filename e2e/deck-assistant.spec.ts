import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const KURIBOH = 40640057
const RAIGEKI = 12580477
const STARDUST_DRAGON = 44508094

test.describe('AI deck assistant', () => {
  test('builds a deck from owned cards, then offers improvements on it', async ({ page }) => {
    await registerAndLogin(page)

    // Seed the inventory through the API — `page.request` shares the page's
    // session cookie, so this is the same authenticated user. The Playwright
    // webServer runs with NUXT_ASSISTANT_PROVIDER=fake, so the assistant is
    // enabled and deterministic (see createFakeModel in
    // server/utils/deck-assistant-model.ts).
    for (const [catalogCardId, quantity] of [
      [DARK_MAGICIAN, 3],
      [KURIBOH, 2],
      [RAIGEKI, 1],
      [STARDUST_DRAGON, 1],
    ] as const) {
      const response = await page.request.post('/api/inventory', {
        data: { catalog_card_id: catalogCardId, quantity },
      })
      expect(response.ok()).toBe(true)
    }

    // --- Build a new deck via the assistant ---------------------------------
    await page.goto('/decks')
    await page.getByRole('link', { name: 'Mit KI erstellen', exact: true }).click()
    await expect(page).toHaveURL('/decks/assistent')
    await expect(page.getByRole('heading', { name: 'KI-Deckassistent', exact: true })).toBeVisible()

    await page.getByLabel('Format', { exact: true }).click()
    await page.getByRole('option', { name: 'TCG Advanced', exact: true }).click()

    await page.getByRole('button', { name: 'Vorschläge erzeugen', exact: true }).click()

    // A real model call can take up to a minute; the fake model is instant,
    // but give this a generous timeout to stay robust either way.
    await expect(page.getByText('Testvorschlag des deterministischen Assistenten')).toBeVisible({ timeout: 60_000 })

    // Scoped to their own landmark regions: the inventory-owned pool sits
    // next to these on other pages, and a bare page-wide text lookup would
    // be ambiguous (strict-mode violation) once a card appears more than
    // once on the page.
    const proposal = page.getByRole('region', { name: 'Deckvorschlag (aus deinem Inventar)', exact: true })
    await expect(proposal).toBeVisible()
    await expect(proposal.getByText('Dark Magician')).toBeVisible()

    // Mirror Force is unrestricted in the TCG and not owned -> suggested as
    // missing. Pot of Greed is Forbidden in the TCG -> must never appear.
    const missing = page.getByRole('region', { name: 'Fehlende Karten (nicht oder nicht genug im Inventar)', exact: true })
    await expect(missing).toBeVisible()
    await expect(missing.getByText('Mirror Force')).toBeVisible()
    await expect(missing.getByText('Pot of Greed')).toHaveCount(0)

    // --- Save the proposal as a real deck -----------------------------------
    await page.getByRole('button', { name: 'Als Deck speichern', exact: true }).click()
    await expect(page.getByLabel('Deckname', { exact: true })).toHaveValue(/KI-Deck/)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()

    await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/)
    const deckUrl = new URL(page.url()).pathname
    // The deck's own remove-button aria-label proves the card landed in the
    // Main Deck section specifically, without a bare text lookup that would
    // also match the "Aus Inventar hinzufügen" panel next to it. `exact` is
    // required here: without it, this substring-matches the *other* row
    // control "Eine Kopie von Dark Magician aus dem Main Deck entfernen" too.
    await expect(page.getByLabel('Dark Magician aus dem Main Deck entfernen', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Anzahl im Main Deck', { exact: true })).toHaveText('6/40–60')
    await expect(page.getByLabel('Anzahl im Extra Deck', { exact: true })).toHaveText('1/15')

    // --- Ask for improvements on the saved deck -----------------------------
    await page.getByRole('button', { name: 'KI-Vorschläge', exact: true }).click()
    // The slideover and the deck page behind it can both show a card name or
    // an "Übernehmen" label, so every assertion below is scoped to the
    // slideover's own dialog container.
    const slideover = page.getByRole('dialog', { name: 'KI-Vorschläge für dieses Deck', exact: true })
    await expect(slideover).toBeVisible()

    await slideover.getByRole('button', { name: 'Vorschläge erzeugen', exact: true }).click()
    await expect(slideover.getByText('Testvorschlag des deterministischen Assistenten')).toBeVisible({ timeout: 60_000 })
    await expect(slideover.getByText('Vorgeschlagene Änderungen (aus deinem Inventar)')).toBeVisible()

    // exact: true matters here too — "Alle übernehmen" case-insensitively
    // contains "Übernehmen" as a substring and would otherwise match first.
    const applyButton = slideover.getByRole('button', { name: 'Übernehmen', exact: true }).first()
    await applyButton.click()

    // Applying a change relabels its own button to "Übernommen" and disables
    // it (see app/pages/decks/[id].vue) — the "Übernehmen" locator above no
    // longer matches that button afterwards, so assert on the new label.
    const appliedButton = slideover.getByRole('button', { name: 'Übernommen', exact: true }).first()
    await expect(appliedButton).toBeVisible()
    await expect(appliedButton).toBeDisabled()

    // The fake model's only "add" candidates are already at their owned cap
    // for this seeded inventory, so its one change is removing a single main
    // deck copy — the main count must drop by exactly one.
    await expect(page.getByLabel('Anzahl im Main Deck', { exact: true })).toHaveText('5/40–60')

    await expect(page).toHaveURL(new RegExp(deckUrl.replace(/[/-]/g, '\\$&')))
  })
})
