import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ActionCard from '~/components/assistant/ActionCard.vue'
import type { AssistantActionView } from '~~/shared/assistant-chat'

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
})
