import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

test.describe('Schnellerfassung', () => {
  test('turns a pasted list into reviewed inventory entries', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/inventory')
    await waitForHydration(page)
    await page.getByRole('link', { name: 'Schnellerfassung' }).click()
    await expect(page).toHaveURL('/inventory/quick-entry')

    // "SDY-006" is a Dark Magician printing in the seeded catalog fixture.
    await page.getByLabel('Kartenliste').fill('2x Dark Magician\nPot of Greed\nSDY-006')
    await page.getByRole('button', { name: 'Karten erkennen' }).click()

    await expect(page.getByText('3 gesamt')).toBeVisible()
    await expect(page.getByText('3 sicher')).toBeVisible()
    await expect(page.getByText('0 unsicher')).toBeVisible()
    await expect(page.getByText('0 ohne Treffer')).toBeVisible()
    await expect(page.getByText('Kein Treffer')).toHaveCount(0)

    const saveAll = page.getByRole('button', { name: 'Alle speichern' })
    await expect(saveAll).toBeEnabled()
    await saveAll.click()

    // The toast title is also announced in an aria-live region, so match the first occurrence.
    await expect(page.getByText('Karten gespeichert').first()).toBeVisible()
    await expect(page.getByText('Noch nichts zu prüfen')).toBeVisible()

    await page.goto('/inventory')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Übersicht' }).click()

    // 2 loose copies + 1 from the SDY-006 printing row.
    await expect(page.getByText(CARD.darkMagician).first()).toBeVisible()
    await expect(page.getByText('×3 ges.')).toBeVisible()
    await expect(page.getByText(CARD.potOfGreed).first()).toBeVisible()
  })

  test('recognizes German card names (ADR 0015)', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/inventory/quick-entry')
    await waitForHydration(page)

    await page.getByLabel('Kartenliste').fill('2x Dunkler Magier\nTopf der Gier')
    await page.getByRole('button', { name: 'Karten erkennen' }).click()

    await expect(page.getByText('2 gesamt')).toBeVisible()
    await expect(page.getByText('2 sicher')).toBeVisible()
    await expect(page.getByText('0 ohne Treffer')).toBeVisible()
    // The matched cards, shown with their German names (card language, F3c).
    await expect(page.getByText(CARD.darkMagician).first()).toBeVisible()
    await expect(page.getByText(CARD.potOfGreed).first()).toBeVisible()
  })

  // Photo/voice input moved to the chat assistant (see e2e/assistant-chat.spec.ts,
  // added alongside docs in the following stage) — /inventory/quick-entry now only
  // links there instead of offering its own Foto/Sprache modes.
  test('points to the assistant for photo input', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/inventory/quick-entry')

    await expect(page.getByText('Karten per Foto? Nutze den Assistenten')).toBeVisible()
    await page.getByRole('link', { name: 'Zum Assistenten' }).click()
    await expect(page).toHaveURL(/\/assistant/)
  })
})
