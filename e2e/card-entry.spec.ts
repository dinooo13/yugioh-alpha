import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

test.describe('Schnellerfassung', () => {
  test('turns a pasted list into reviewed inventory entries', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/inventar')
    await page.getByRole('link', { name: 'Schnellerfassung' }).click()
    await expect(page).toHaveURL('/inventar/erfassen')

    // "SDY-006" is a Dark Magician printing in the seeded catalog fixture.
    await page.getByLabel('Kartenliste').fill('2x Dark Magician\nPot of Greed\nSDY-006')
    await page.getByRole('button', { name: 'Vorschläge laden' }).click()

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

    await page.goto('/inventar')
    await page.getByRole('button', { name: 'Übersicht' }).click()

    // 2 loose copies + 1 from the SDY-006 printing row.
    await expect(page.getByText('Dark Magician').first()).toBeVisible()
    await expect(page.getByText('×3 ges.')).toBeVisible()
    await expect(page.getByText('Pot of Greed').first()).toBeVisible()
  })

  test('offers photo and speech input modes', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/inventar/erfassen')

    await page.getByRole('button', { name: 'Foto' }).click()
    await expect(page.getByText('Foto der Karte aufnehmen oder hierher ziehen')).toBeVisible()
    await expect(page.getByLabel('Kartenfoto auswählen')).toBeVisible()

    await page.getByRole('button', { name: 'Sprache' }).click()
    // Headless Chromium exposes the Web Speech API constructor but cannot
    // actually record, so accept either the controls or the fallback hint.
    const controls = page.getByRole('button', { name: 'Aufnahme starten' })
    const hint = page.getByText('Spracheingabe wird hier nicht unterstützt')
    await expect(controls.or(hint)).toBeVisible()
  })
})
