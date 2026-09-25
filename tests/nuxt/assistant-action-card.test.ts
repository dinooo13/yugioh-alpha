import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ActionCard from '~/components/assistant/ActionCard.vue'
import type { AssistantActionView } from '~~/shared/assistant-chat'
import { setTestLocale } from './fixtures/locale'

function deckAction(overrides: Partial<AssistantActionView> = {}): AssistantActionView {
  return {
    id: 'action-1',
    messageId: 'm1',
    kind: 'update_deck_cards',
    summary: '2 Kartenänderung(en) an Deck "Magier"',
    payload: {
      deckId: 'deck-1',
      deckName: 'Magier',
      changes: [
        { catalogCardId: 46986414, section: 'main', quantity: 3, name: 'Dark Magician' },
        { catalogCardId: 55144522, section: 'main', quantity: 0, name: 'Pot of Greed' },
      ],
      preview: {
        formatId: 'fmt-1',
        formatName: 'Streng',
        counts: { main: 41, extra: 2, side: 0, total: 43 },
        validation: {
          legal: false,
          issues: ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => `Problem ${letter}`),
        },
        missing: [{ catalogCardId: 46986414, name: 'Dark Magician', needed: 3, owned: 1 }],
      },
    },
    status: 'pending',
    ...overrides,
  }
}

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

describe('AssistantActionCard', () => {
  it('shows the proposal preview: legality badge, counts, at most 5 issues, and the missing cards', async () => {
    const component = await mountSuspended(ActionCard, { props: { action: deckAction() } })
    const preview = component.find('[data-testid="action-preview"]')
    expect(preview.exists()).toBe(true)

    const text = preview.text()
    expect(text).toContain('Nicht legal – 6 Probleme')
    expect(text).toContain('Main 41 · Extra 2 · Side 0')
    expect(text).toContain('Problem E')
    expect(text).not.toContain('Problem F')
    expect(text).toContain('… und 1 weitere')
    expect(text).toContain('Fehlende Karten (nicht oder nicht genug im Inventar)')
    expect(text).toContain('Dark Magician: 3 benötigt, 1 im Besitz')
    expect(text).toContain('Stand beim Vorschlag')
  })

  it('labels a legal preview and one without a format', async () => {
    const legal = deckAction()
    legal.payload = { ...legal.payload, preview: { formatId: 'f', formatName: 'F', counts: { main: 40, extra: 0, side: 0, total: 40 }, validation: { legal: true, issues: [] }, missing: [] } }
    const legalCard = await mountSuspended(ActionCard, { props: { action: legal } })
    expect(legalCard.find('[data-testid="action-preview"]').text()).toContain('Legal')
    expect(legalCard.text()).not.toContain('Fehlende Karten')

    const noFormat = deckAction()
    noFormat.payload = { ...noFormat.payload, preview: { formatId: null, formatName: null, counts: { main: 1, extra: 0, side: 0, total: 1 }, validation: null, missing: [] } }
    const noFormatCard = await mountSuspended(ActionCard, { props: { action: noFormat } })
    expect(noFormatCard.find('[data-testid="action-preview"]').text()).toContain('Kein Format')
  })

  it('shows card names instead of catalog ids, and the deck name in the details', async () => {
    const component = await mountSuspended(ActionCard, { props: { action: deckAction() } })
    const toggle = component.findAll('button').find(button => button.text().includes('Details anzeigen'))
    await toggle!.trigger('click')

    const text = component.text()
    expect(text).toContain('Deck: Magier')
    expect(text).not.toContain('deck-1')
    expect(text).toContain('Neue Menge')
    expect(text).toContain('Pot of Greed')
    expect(text).not.toContain('Karte (ID)')
    expect(text).not.toContain('55144522')
  })

  it('shows the deck of a proposal stored without its name by its current name, never its id (#69)', async () => {
    const payload = { deckId: 'deck-1', changes: [{ catalogCardId: 46986414, section: 'main', quantity: 3, name: 'Dark Magician' }] }
    const named = await mountSuspended(ActionCard, { props: { action: deckAction({ payload, display: { deckName: 'Magier (neu)' } }) } })
    await named.findAll('button').find(button => button.text().includes('Details anzeigen'))!.trigger('click')
    expect(named.text()).toContain('Deck: Magier (neu)')
    expect(named.text()).not.toContain('deck-1')

    const gone = await mountSuspended(ActionCard, { props: { action: deckAction({ payload, display: { deckName: null } }) } })
    await gone.findAll('button').find(button => button.text().includes('Details anzeigen'))!.trigger('click')
    expect(gone.text()).toContain('Deck: Gelöschtes Deck')
    expect(gone.text()).not.toContain('deck-1')
  })

  it('shows collections by name, "Unbekannte Sammlung" for a gone one, never their ids (#69)', async () => {
    const action = deckAction({
      kind: 'add_to_inventory',
      payload: {
        items: [
          { catalogCardId: 1, name: 'Dark Magician', quantity: 1, collectionId: 'col-1' },
          { catalogCardId: 2, name: 'Pot of Greed', quantity: 1, collectionId: 'col-gone' },
          { catalogCardId: 3, name: 'Kuriboh', quantity: 1, collectionId: null },
        ],
      },
      display: { collectionNames: { 'col-1': 'Box 1', 'col-gone': null } },
    })
    const component = await mountSuspended(ActionCard, { props: { action } })
    await component.findAll('button').find(button => button.text().includes('Details anzeigen'))!.trigger('click')
    const text = component.text()
    expect(text).toContain('Box 1')
    expect(text).toContain('Unbekannte Sammlung')
    expect(text).not.toContain('col-1')
    expect(text).not.toContain('col-gone')
    expect(text).not.toContain('null')
  })

  describe('the preview\'s deck warnings (#148)', () => {
    const smallDeck = { code: 'main_below_min', message: 'The Main Deck has 5 cards; the usual minimum is 40.', params: { section: 'main', count: 5, min: 40 } }
    const copies = { code: 'copies_above_max', cardId: 46986414, message: 'Dark Magician: 4 copies in the deck; the usual maximum is 3.', params: { cardId: 46986414, cardName: 'Dark Magician', copies: 4, maxCopies: 3 } }
    const retired = { code: 'card_retired', cardId: 1, message: 'Old Magician is no longer in the catalog; its banlist status and card data are no longer updated.', params: { cardId: 1, cardName: 'Old Magician' } }

    function withPreview(preview: Record<string, unknown>) {
      const action = deckAction()
      action.payload = {
        ...action.payload,
        preview: { formatId: null, formatName: null, counts: { main: 5, extra: 0, side: 0, total: 5 }, validation: null, missing: [], ...preview },
      }
      return action
    }

    it('shows them in the interface language, from code + params', async () => {
      const component = await mountSuspended(ActionCard, {
        props: { action: withPreview({ warnings: ['English only'], warningDetails: [smallDeck, copies, retired] }) },
      })
      const warnings = component.find('[data-testid="action-preview-warnings"]')
      expect(warnings.exists()).toBe(true)
      expect(warnings.text()).toContain('Hinweise zum Deckaufbau')
      expect(warnings.text()).toContain('Das Main Deck hat 5 Karten, mindestens 40 sind üblich.')
      expect(warnings.text()).toContain('Dark Magician: 4 Kopien im Deck, höchstens 3 sind üblich.')
      expect(warnings.text()).toContain('Old Magician ist nicht mehr im Katalog')
      expect(component.text()).not.toContain('English only')
    })

    it('shows only the retired-card warning when a format is in play, like the deck editor', async () => {
      const component = await mountSuspended(ActionCard, {
        props: { action: withPreview({ formatId: 'f', formatName: 'F', validation: { legal: true, issues: [] }, warningDetails: [smallDeck, copies, retired] }) },
      })
      const text = component.find('[data-testid="action-preview-warnings"]').text()
      expect(text).toContain('Old Magician ist nicht mehr im Katalog')
      expect(text).not.toContain('Main Deck hat 5 Karten')
      expect(text).not.toContain('4 Kopien')

      const noRetired = await mountSuspended(ActionCard, {
        props: { action: withPreview({ formatId: 'f', formatName: 'F', validation: { legal: true, issues: [] }, warningDetails: [smallDeck] }) },
      })
      expect(noRetired.find('[data-testid="action-preview-warnings"]').exists()).toBe(false)
    })

    it('shows nothing for a preview stored before #148 (only the English texts, or none at all)', async () => {
      const onlyTexts = await mountSuspended(ActionCard, { props: { action: withPreview({ warnings: ['The Main Deck has 5 cards; the usual minimum is 40.'] }) } })
      expect(onlyTexts.find('[data-testid="action-preview"]').exists()).toBe(true)
      expect(onlyTexts.find('[data-testid="action-preview-warnings"]').exists()).toBe(false)
      expect(onlyTexts.text()).not.toContain('usual minimum')

      const none = await mountSuspended(ActionCard, { props: { action: deckAction() } })
      expect(none.find('[data-testid="action-preview-warnings"]').exists()).toBe(false)
    })

    it('shows them in English with an English interface', async () => {
      await setTestLocale('en')
      try {
        const component = await mountSuspended(ActionCard, { props: { action: withPreview({ warningDetails: [smallDeck] }) } })
        const text = component.find('[data-testid="action-preview-warnings"]').text()
        expect(text).toContain('Deck-building hints')
        expect(text).toContain('The Main Deck has 5 cards; the usual minimum is 40.')
      }
      finally {
        await setTestLocale('de')
      }
    })
  })

  describe('a package of proposals (ADR 0026)', () => {
    it('marks a preview computed with the other proposals of the answer, in German and English', async () => {
      const action = deckAction()
      action.payload = { ...action.payload, preview: { ...(action.payload.preview as object), combined: true } }
      const component = await mountSuspended(ActionCard, { props: { action } })
      expect(component.find('[data-testid="action-preview-combined"]').text()).toBe('Vorschau mit den anderen Vorschlägen dieser Antwort')

      await setTestLocale('en')
      try {
        const english = await mountSuspended(ActionCard, { props: { action } })
        expect(english.find('[data-testid="action-preview-combined"]').text()).toBe('Preview includes the other proposals in this answer')
      }
      finally {
        await setTestLocale('de')
      }

      const alone = await mountSuspended(ActionCard, { props: { action: deckAction() } })
      expect(alone.find('[data-testid="action-preview-combined"]').exists()).toBe(false)
    })

    it('hands on the recomputed views of the package\'s other proposals after apply or reject', async () => {
      const other = deckAction({ id: 'action-2', kind: 'set_deck_format' })
      for (const kind of ['apply', 'reject'] as const) {
        vi.stubGlobal('$fetch', vi.fn((url: string) => Promise.resolve(url === `/api/assistant/chat/actions/action-1/${kind}`
          ? { action: deckAction({ status: kind === 'apply' ? 'applied' : 'rejected' }), related: [other] }
          : null)))
        const component = await mountSuspended(ActionCard, { props: { action: deckAction() } })
        const button = component.findAll('button').find(candidate => candidate.text() === (kind === 'apply' ? 'Übernehmen' : 'Verwerfen'))
        await button!.trigger('click')
        await flushPromises()
        expect(component.emitted('updated')!.map(([view]) => (view as AssistantActionView).id)).toEqual(['action-1', 'action-2'])
      }
      vi.unstubAllGlobals()
    })
  })

  it('keeps the title readable: the status badge wraps under it instead of cutting it off', async () => {
    const component = await mountSuspended(ActionCard, { props: { action: deckAction({ kind: 'set_deck_format' }) } })
    const title = component.find('[data-testid="action-title"]')
    expect(title.text()).toBe('Deck-Format ändern')
    expect(title.element.parentElement!.className).toContain('flex-wrap')
    expect(title.html()).not.toContain('truncate')
  })

  it('renders an older action without preview or names as before', async () => {
    const component = await mountSuspended(ActionCard, {
      props: {
        action: deckAction({ payload: { deckId: 'deck-1', changes: [{ catalogCardId: 46986414, section: 'main', quantity: 1 }] } }),
      },
    })
    expect(component.find('[data-testid="action-preview"]').exists()).toBe(false)
    const toggle = component.findAll('button').find(button => button.text().includes('Details anzeigen'))
    await toggle!.trigger('click')
    expect(component.text()).toContain('Karte (ID)')
    expect(component.text()).toContain('46986414')
  })

  it('offers "Deck öffnen" once a create_deck proposal was applied', async () => {
    const pending = await mountSuspended(ActionCard, {
      props: { action: deckAction({ kind: 'create_deck', summary: 'Neues Deck "X" mit 3 Karte(n) anlegen' }) },
    })
    expect(pending.find('a[href^="/decks/"]').exists()).toBe(false)

    const applied = await mountSuspended(ActionCard, {
      props: {
        action: deckAction({ kind: 'create_deck', status: 'applied', result: { id: 'new-deck', name: 'X' } }),
      },
    })
    const link = applied.find('a[href="/decks/new-deck"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Deck öffnen')
  })

  function formatAction(overrides: Partial<AssistantActionView> = {}): AssistantActionView {
    return {
      id: 'action-2',
      messageId: 'm1',
      kind: 'set_deck_format',
      summary: 'Format von Deck "Magier" ändern: kein Format → TCG',
      payload: {
        deckId: 'deck-1',
        deckName: 'Magier',
        formatId: 'tcg',
        formatName: 'TCG',
        previousFormatId: null,
        previousFormatName: null,
        preview: {
          formatId: 'tcg',
          formatName: 'TCG',
          counts: { main: 40, extra: 0, side: 0, total: 40 },
          validation: { legal: false, issues: ['Pot of Greed: verboten'] },
          missing: [],
        },
      },
      status: 'pending',
      ...overrides,
    }
  }

  it('shows a set_deck_format proposal: label, summary, preview, and the old/new format in the details', async () => {
    const component = await mountSuspended(ActionCard, { props: { action: formatAction() } })
    expect(component.text()).toContain('Deck-Format ändern')
    expect(component.text()).toContain('Format von Deck "Magier" ändern: kein Format → TCG')
    const preview = component.find('[data-testid="action-preview"]')
    expect(preview.exists()).toBe(true)
    expect(preview.text()).toContain('Nicht legal – 1 Problem')
    expect(preview.text()).toContain('Pot of Greed: verboten')

    const toggle = component.findAll('button').find(button => button.text().includes('Details anzeigen'))
    await toggle!.trigger('click')
    const text = component.text()
    expect(text).toContain('Deck: Magier')
    expect(text).toContain('Bisheriges Format: Kein Format')
    expect(text).toContain('Neues Format: TCG')
    expect(component.find('table').exists()).toBe(false)
  })

  it('offers "Deck öffnen" once a set_deck_format proposal was applied', async () => {
    const pending = await mountSuspended(ActionCard, { props: { action: formatAction() } })
    expect(pending.find('a[href^="/decks/"]').exists()).toBe(false)

    const applied = await mountSuspended(ActionCard, {
      props: { action: formatAction({ status: 'applied', result: { id: 'deck-1', name: 'Magier' } }) },
    })
    const link = applied.find('a[href="/decks/deck-1"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Deck öffnen')
  })

  // --- #34 F2d: rendered from kind + payload in the interface language ---

  function inventoryAction(overrides: Partial<AssistantActionView> = {}): AssistantActionView {
    return {
      id: 'action-3',
      messageId: 'm1',
      kind: 'add_to_inventory',
      // Stored English since F2d — the card renders its own summary.
      summary: 'Add 2 card(s) to the inventory: Dark Magician x2, Pot of Greed x1',
      // Stored before ADR 0017: the items still carry the collector fields.
      payload: {
        items: [
          { catalogCardId: 46986414, quantity: 2, language: 'de', condition: 'near_mint', edition: 'first', collectionId: null, printingId: null, note: null, name: 'Dark Magician' },
          { catalogCardId: 55144522, quantity: 1, language: 'en', condition: 'played', edition: 'unlimited', collectionId: null, printingId: null, note: null, name: 'Pot of Greed' },
        ],
      },
      status: 'pending',
      ...overrides,
    }
  }

  function issueDetailsAction(): AssistantActionView {
    return formatAction({
      summary: 'Change the format of the deck "Magier": no format → No banlist',
      payload: {
        deckId: 'deck-1',
        deckName: 'Magier',
        formatId: 'unlimited',
        formatName: 'No banlist',
        previousFormatId: 'goat',
        previousFormatName: 'GOAT Format',
        preview: {
          formatId: 'unlimited',
          formatName: 'No banlist',
          counts: { main: 40, extra: 0, side: 0, total: 40 },
          validation: {
            legal: false,
            issues: ['Dark Magician: 4 copies in the deck; 3 copies are allowed.'],
            issueDetails: [{
              severity: 'error',
              code: 'card_limit_exceeded',
              message: 'Dark Magician: 4 copies in the deck; 3 copies are allowed.',
              params: { cardId: 46986414, cardName: 'Dark Magician', copies: 4, maxCopies: 3 },
              cardId: 46986414,
            }],
          },
          missing: [],
        },
      },
    })
  }

  describe('in German', () => {
    it('renders an add_to_inventory summary and rows from the payload, without collector details', async () => {
      const component = await mountSuspended(ActionCard, { props: { action: inventoryAction() } })
      expect(component.text()).toContain('2 Karten zum Inventar hinzufügen: Dark Magician x2, Pot of Greed x1')
      expect(component.text()).not.toContain('Add 2 card(s)')

      const toggle = component.findAll('button').find(button => button.text().includes('Details anzeigen'))
      await toggle!.trigger('click')
      const headers = component.findAll('th').map(th => th.text())
      expect(headers).toEqual(['Karte', 'Menge'])
      const text = component.text()
      expect(text).not.toContain('Neuwertig')
      expect(text).not.toContain('1. Auflage')
      expect(text).not.toContain('Near Mint')
      expect(text).not.toContain('46986414')
    })

    it('falls back to the stored summary for an older add_to_inventory action without card names', async () => {
      const component = await mountSuspended(ActionCard, {
        props: {
          action: inventoryAction({
            summary: '1 Karte(n) zum Inventar hinzufügen: Dark Magician x2',
            payload: { items: [{ catalogCardId: 46986414, quantity: 2 }] },
          }),
        },
      })
      expect(component.text()).toContain('1 Karte(n) zum Inventar hinzufügen: Dark Magician x2')
    })

    it('renders preview issues from code + params and built-in format names by id', async () => {
      const component = await mountSuspended(ActionCard, { props: { action: issueDetailsAction() } })
      const text = component.text()
      expect(text).toContain('Format von Deck "Magier" ändern: GOAT Format → Ohne Banliste')
      expect(text).toContain('Dark Magician: 4 Kopien im Deck, erlaubt sind 3 Kopien.')
      expect(text).not.toContain('copies are allowed')
    })
  })

  describe('card language (ADR 0015)', () => {
    afterEach(async () => {
      useState('card-locale-choice').value = null
      await setTestLocale('de')
    })

    function germanNamesAction(): AssistantActionView {
      const action = deckAction()
      action.payload = {
        ...action.payload,
        changes: [
          { catalogCardId: 46986414, section: 'main', quantity: 3, name: 'Dark Magician', nameDe: 'Dunkler Magier' },
          { catalogCardId: 4343, section: 'main', quantity: 1, name: 'Raigeki', nameDe: null },
        ],
        preview: {
          formatId: 'fmt-1',
          formatName: 'Streng',
          counts: { main: 41, extra: 0, side: 0, total: 41 },
          validation: {
            legal: false,
            issues: ['Dark Magician is forbidden in this format.'],
            issueDetails: [{
              severity: 'error',
              code: 'card_forbidden',
              message: 'Dark Magician is forbidden in this format.',
              params: { cardId: 46986414, cardName: 'Dark Magician', cardNameDe: 'Dunkler Magier' },
              cardId: 46986414,
            }],
          },
          missing: [{ catalogCardId: 46986414, name: 'Dark Magician', nameDe: 'Dunkler Magier', needed: 3, owned: 1 }],
        },
      }
      return action
    }

    async function detailsText(action: AssistantActionView) {
      const component = await mountSuspended(ActionCard, { props: { action } })
      const toggle = component.findAll('button').find(button => button.text().match(/Details anzeigen|Show details/))
      await toggle!.trigger('click')
      return component.text()
    }

    it('shows rows, missing cards and issues with German names, English for cards without one', async () => {
      const text = await detailsText(germanNamesAction())
      expect(text).toContain('Dunkler Magier')
      expect(text).toContain('Raigeki')
      expect(text).toContain('Dunkler Magier: 3 benötigt, 1 im Besitz')
      expect(text).not.toContain('Dark Magician')
    })

    it('shows the English names when the card language is English', async () => {
      useState('card-locale-choice').value = 'en'
      const text = await detailsText(germanNamesAction())
      expect(text).toContain('Dark Magician: 3 benötigt, 1 im Besitz')
      expect(text).not.toContain('Dunkler Magier')
    })
  })

  describe('in English', () => {
    afterEach(() => setTestLocale('de'))

    it('renders the summary, labels, preview and details in English', async () => {
      await setTestLocale('en')
      const component = await mountSuspended(ActionCard, { props: { action: issueDetailsAction() } })
      const text = component.text()
      expect(text).toContain('Change the deck format')
      expect(text).toContain('Waiting for confirmation')
      expect(text).toContain('Change the format of the deck "Magier": GOAT Format → No banlist')
      expect(text).toContain('Not legal – 1 issue')
      expect(text).toContain('Dark Magician: 4 copies in the deck; 3 copies are allowed.')
      expect(text).toContain('As of the proposal')

      const toggle = component.findAll('button').find(button => button.text().includes('Show details'))
      await toggle!.trigger('click')
      expect(component.text()).toContain('Previous format:')
      expect(component.text()).toContain('New format:')
      expect(component.findAll('button').map(button => button.text())).toEqual(expect.arrayContaining(['Hide details', 'Apply', 'Reject']))
    })

    it('renders an add_to_inventory proposal in English, without collector details', async () => {
      await setTestLocale('en')
      const component = await mountSuspended(ActionCard, { props: { action: inventoryAction() } })
      expect(component.text()).toContain('Add cards to the inventory')
      expect(component.text()).toContain('Add 2 cards to the inventory: Dark Magician x2, Pot of Greed x1')

      const toggle = component.findAll('button').find(button => button.text().includes('Show details'))
      await toggle!.trigger('click')
      expect(component.findAll('th').map(th => th.text())).toEqual(['Card', 'Quantity'])
      expect(component.text()).not.toContain('Near Mint')
      expect(component.text()).not.toContain('1st Edition')
    })

    it('uses the English singular for a one-card deck proposal', async () => {
      await setTestLocale('en')
      const single = await mountSuspended(ActionCard, {
        props: { action: deckAction({ kind: 'create_deck', payload: { name: 'Solo', cards: [{ catalogCardId: 1, section: 'main', quantity: 1, name: 'X' }] } }) },
      })
      expect(single.text()).toContain('Create the new deck "Solo" with 1 card')
      expect(single.text()).not.toContain('1 cards')
    })
  })
})
