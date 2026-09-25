import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { h } from 'vue'
import CardDetailModal from '~/components/card/CardDetailModal.vue'
import type { CardDetailPreview, CatalogCardDetail } from '~/utils/card-detail'
import { setTestLocale } from './fixtures/locale'

// UModal teleports its content to <body> (same note as in catalog-page.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

function dialog() {
  return body().find('[role="dialog"]')
}

afterEach(async () => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  useState('card-locale-choice').value = null
  await setTestLocale('de')
})

enableAutoUnmount(afterEach)

function cardDetail(overrides: Partial<CatalogCardDetail['card']> = {}, rest: Partial<Omit<CatalogCardDetail, 'card'>> = {}): CatalogCardDetail {
  return {
    card: {
      id: 1,
      name: 'Blue-Eyes White Dragon',
      nameDe: 'Blauäugiger w. Drache',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'This legendary dragon is a powerful engine of destruction.',
      descDe: 'Dieser legendäre Drache ist eine mächtige Zerstörungsmaschine.',
      race: 'Dragon',
      archetype: null,
      attribute: 'LIGHT',
      atk: 3000,
      def: 2500,
      level: 8,
      linkval: null,
      scale: null,
      linkMarkers: null,
      banlistInfo: null,
      cardPrices: null,
      tcgDate: '2002-03-08',
      ocgDate: null,
      ygoprodeckUrl: null,
      retired: false,
      replacedById: null,
      ...overrides,
    },
    printings: [{ setCode: 'LOB-001', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: null }],
    images: [{ id: 1, imageUrl: 'https://images.example/bewd.jpg', imageUrlSmall: 'https://images.example/bewd-small.jpg', imageUrlCropped: null }],
    ...rest,
  }
}

const preview: CardDetailPreview = {
  name: 'Blue-Eyes White Dragon',
  nameDe: 'Blauäugiger w. Drache',
  type: 'Normal Monster',
  frameType: 'normal',
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2500,
  imageSmall: 'https://images.example/bewd-small.jpg',
}

async function mountModal(options: {
  detail?: CatalogCardDetail | Promise<CatalogCardDetail>
  fetch?: ReturnType<typeof vi.fn>
  props?: Record<string, unknown>
} = {}) {
  const fetch = options.fetch ?? vi.fn(() => Promise.resolve(options.detail ?? cardDetail()))
  vi.stubGlobal('$fetch', fetch)
  const component = await mountSuspended(CardDetailModal, {
    props: { open: true, cardId: 1, ...options.props },
    slots: {
      actions: () => h('button', { type: 'button' }, 'Aktion'),
      context: () => h('p', 'Kontextbereich'),
    },
  })
  await flushPromises()
  return { component, fetch }
}

describe('CardDetailModal', () => {
  it('catalog, German: name, English name, chips, stats, German text, printings and dates, no source credit', async () => {
    const { fetch } = await mountModal()

    expect(fetch).toHaveBeenCalledWith('/api/catalog/cards/1')
    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Dieser legendäre Drache')
    })
    const text = dialog().text()

    // The card name is the dialog title (an h2) and so the dialog's name.
    expect(dialog().find('h2').text()).toBe('Blauäugiger w. Drache')
    expect(text).toContain('Englisch: Blue-Eyes White Dragon')
    expect(text).toContain('Normales Monster')
    expect(text).toContain('LICHT')
    expect(text).toContain('Drache')
    expect(text).toContain('Stufe 8')
    expect(text).toContain('ATK')
    expect(text).toContain('3000')
    expect(text).toContain('2500')
    expect(text).not.toContain('powerful engine')
    expect(dialog().find('h3').text()).toBe('Kartentext')

    expect(text).toContain('Printings')
    expect(text).toContain('Legend of Blue Eyes White Dragon')
    expect(text).toMatch(/LOB-001\s*·\s*Ultra Rare/)
    expect(text).toContain('TCG')
    expect(text).toContain('2002-03-08')
    expect(text).not.toContain('OCG')

    // The large scan, floating with the foil sheen.
    expect(dialog().find('.foil img').attributes('src')).toBe('https://images.example/bewd.jpg')

    // No source credit (#87, ADR 0017).
    expect(text).not.toContain('Deutsche Kartentexte')
    expect(body().find('a[href*="github.com"]').exists()).toBe(false)

    expect(text).toContain('Aktion')
    expect(text).toContain('Kontextbereich')
  })

  it('shows a "?" stat (stored as -1) as "?" and a missing one (a Link\'s DEF) as a dash (#134)', async () => {
    function stat(label: 'ATK' | 'DEF') {
      const term = dialog().findAll('dt').find(dt => dt.text() === label)
      return term?.element.nextElementSibling?.textContent?.trim()
    }

    const first = await mountModal({ detail: cardDetail({ atk: -1, def: -1 }) })
    await vi.waitFor(() => {
      expect(stat('ATK')).toBe('?')
    })
    expect(stat('DEF')).toBe('?')
    expect(dialog().text()).not.toContain('-1')

    first.component.unmount()
    await vi.waitFor(() => {
      expect(dialog().exists()).toBe(false)
    })
    await mountModal({ detail: cardDetail({ type: 'Link Monster', frameType: 'link', atk: 2300, def: null, level: null, linkval: 3 }) })
    await vi.waitFor(() => {
      expect(stat('ATK')).toBe('2300')
    })
    expect(stat('DEF')).toBe('–')
    // The Link rating, not a level (#101).
    expect(dialog().text()).toContain('Link 3')
    expect(dialog().text()).not.toContain('Stufe')
  })

  describe('Pendulum scale', () => {
    function term(label: string) {
      const dt = dialog().findAll('dt').find(item => item.text() === label)
      return dt?.element.nextElementSibling?.textContent?.trim()
    }
    const pendulum = { type: 'Pendulum Effect Monster', frameType: 'effect_pendulum', level: 7 }

    it('shows a Pendulum monster\'s scale next to ATK/DEF', async () => {
      await mountModal({ detail: cardDetail({ ...pendulum, scale: 4 }) })

      await vi.waitFor(() => {
        expect(term('Pendelbereich')).toBe('4')
      })
      expect(term('ATK')).toBe('3000')
    })

    it('shows scale 0, a real value', async () => {
      await mountModal({ detail: cardDetail({ ...pendulum, scale: 0 }) })

      await vi.waitFor(() => {
        expect(term('Pendelbereich')).toBe('0')
      })
    })

    it('shows no scale for a non-Pendulum card', async () => {
      await mountModal()

      await vi.waitFor(() => {
        expect(term('ATK')).toBe('3000')
      })
      expect(dialog().text()).not.toContain('Pendelbereich')
    })

    it('labels it in English', async () => {
      await setTestLocale('en')
      await mountModal({ detail: cardDetail({ ...pendulum, scale: 8 }) })

      await vi.waitFor(() => {
        expect(term('Pendulum Scale')).toBe('8')
      })
    })
  })

  it('shows an Xyz monster\'s rank (#101)', async () => {
    await mountModal({ detail: cardDetail({ type: 'XYZ Monster', frameType: 'xyz', level: 4 }) })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Rang 4')
    })
    expect(dialog().text()).not.toContain('Stufe')
  })

  it('falls back to the English text with a hint when a card has no German data', async () => {
    await mountModal({ detail: cardDetail({ nameDe: null, descDe: null }) })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('powerful engine')
    })
    const text = dialog().text()
    expect(dialog().find('h2').text()).toBe('Blue-Eyes White Dragon')
    expect(text).toContain('Für diese Karte gibt es keinen deutschen Kartentext.')
    expect(text).not.toContain('Englisch:')
  })

  it('shows only English in an English interface', async () => {
    await setTestLocale('en')
    await mountModal()

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('powerful engine')
    })
    const text = dialog().text()
    expect(dialog().find('h2').text()).toBe('Blue-Eyes White Dragon')
    expect(text).toContain('Card text')
    expect(text).toContain('Normal Monster')
    expect(text).not.toContain('Blauäugiger')
    expect(text).not.toContain('English:')
    expect(text).not.toContain('There is no German text')
  })

  it('inventory: the card and the caller\'s context, no English name, printings or dates', async () => {
    await mountModal({ props: { variant: 'inventory' } })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Dieser legendäre Drache')
    })
    const text = dialog().text()
    expect(text).toContain('Kartentext')
    expect(text).toContain('Normales Monster')
    expect(text).toContain('Kontextbereich')
    expect(text).not.toContain('Englisch:')
    expect(text).not.toContain('Printings')
    expect(text).not.toContain('LOB-001')
    expect(text).not.toContain('2002-03-08')

    // The caller's context comes before the card text (#135): the
    // inventory's editor is the overlay's main job there.
    expect(text.indexOf('Kontextbereich')).toBeLessThan(text.indexOf('Kartentext'))
    // Only the card text waits for the catalog detail, not the context.
    const context = dialog().findAll('p').find(p => p.text() === 'Kontextbereich')!
    expect(context.element.closest('[aria-busy]')).toBeNull()
  })

  it('deck: the catalog view without the printings (owner feedback in #148)', async () => {
    await mountModal({ props: { variant: 'deck' } })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Dieser legendäre Drache')
    })
    const text = dialog().text()
    expect(text).toContain('Englisch: Blue-Eyes White Dragon')
    expect(text).toContain('2002-03-08')
    expect(text).toContain('Kontextbereich')
    expect(text).not.toContain('Printings')
    expect(text).not.toContain('LOB-001')
    // The deck editor's quantities (the context) come before the card text.
    expect(text.indexOf('Kontextbereich')).toBeLessThan(text.indexOf('Kartentext'))
  })

  it('shows the preview at once and the text once it has loaded', async () => {
    let resolve!: (detail: CatalogCardDetail) => void
    const fetch = vi.fn(() => new Promise<CatalogCardDetail>((done) => {
      resolve = done
    }))
    await mountModal({ fetch, props: { preview } })

    const text = dialog().text()
    expect(dialog().find('h2').text()).toBe('Blauäugiger w. Drache')
    expect(text).toContain('3000')
    expect(text).not.toContain('Dieser legendäre Drache')
    expect(dialog().find('[aria-busy="true"]').exists()).toBe(true)
    // The small scan from the grid stands in for the large one.
    expect(dialog().find('img').attributes('src')).toBe('https://images.example/bewd-small.jpg')

    resolve(cardDetail())
    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Dieser legendäre Drache')
    })
    expect(dialog().find('[aria-busy="true"]').exists()).toBe(false)
    expect(dialog().find('img').attributes('src')).toBe('https://images.example/bewd.jpg')
  })

  it('shows an error when the card can\'t be loaded', async () => {
    await mountModal({ fetch: vi.fn(() => Promise.reject(new Error('404'))) })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Karte nicht gefunden')
    })
  })

  it('shows the card back without a scan', async () => {
    await mountModal({ detail: cardDetail({}, { images: [] }) })

    await vi.waitFor(() => {
      expect(dialog().text()).toContain('Dieser legendäre Drache')
    })
    expect(dialog().find('img').exists()).toBe(false)
    expect(dialog().find('[role="img"]').attributes('aria-label')).toBe('Blauäugiger w. Drache: Kein Bild')
    expect(dialog().text()).toContain('Kein Bild')
  })

  describe('tilt', () => {
    function stubMotion(allowed: boolean) {
      vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: allowed,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })))
    }

    function hover() {
      const wrapper = dialog().find('.foil').element.parentElement!
      wrapper.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 5, clientY: 5, bubbles: true }))
      return wrapper
    }

    it('tilts the card towards the pointer', async () => {
      stubMotion(true)
      await mountModal()
      const card = hover()
      await vi.waitFor(() => {
        expect(card.style.transform).toContain('rotateX')
      })
    })

    it('keeps the card still under reduced motion', async () => {
      stubMotion(false)
      await mountModal()
      const card = hover()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(card.style.transform).toBe('')
    })
  })

  describe('retired cards (ADR 0019, #108)', () => {
    it('shows the retired alert with a link to the current card', async () => {
      await mountModal({ detail: cardDetail({ retired: true, replacedById: 16178683 }) })

      const alert = await vi.waitFor(() => {
        const found = dialog().find('[data-testid="card-retired-alert"]')
        expect(found.exists()).toBe(true)
        return found
      })
      expect(alert.text()).toContain('Nicht mehr im Katalog')
      expect(alert.text()).toContain('YGOPRODeck führt diese Karte inzwischen unter einer neuen Nummer.')
      const link = alert.find('a')
      expect(link.text()).toBe('Aktuelle Karte anzeigen')
      expect(link.attributes('href')).toBe('/catalog?card=16178683')
    })

    it('shows the alert without an action when there is no replacement', async () => {
      await mountModal({ detail: cardDetail({ retired: true, replacedById: null }) })

      const alert = await vi.waitFor(() => {
        const found = dialog().find('[data-testid="card-retired-alert"]')
        expect(found.exists()).toBe(true)
        return found
      })
      expect(alert.text()).toContain('Kartendaten und Banlist-Status werden nicht mehr aktualisiert.')
      expect(alert.find('a').exists()).toBe(false)
      expect(alert.find('button').exists()).toBe(false)
    })

    it('shows no alert for an active card', async () => {
      await mountModal()
      await vi.waitFor(() => {
        expect(dialog().text()).toContain('Dieser legendäre Drache')
      })
      expect(dialog().find('[data-testid="card-retired-alert"]').exists()).toBe(false)
    })
  })

  describe('artwork passcodes (ADR 0023)', () => {
    it('emits `resolved` when the detail is another card than the requested id', async () => {
      const { component } = await mountModal({
        detail: cardDetail({ id: 46986420, name: 'Dark Magician' }),
        props: { cardId: 46986414 },
      })

      await vi.waitFor(() => {
        expect(component.emitted('resolved')).toEqual([[46986420]])
      })
    })

    it('emits nothing for the canonical id', async () => {
      const { component } = await mountModal()
      await vi.waitFor(() => {
        expect(dialog().text()).toContain('Dieser legendäre Drache')
      })
      expect(component.emitted('resolved')).toBeUndefined()
    })
  })

  it('loads nothing while closed', async () => {
    const { fetch } = await mountModal({ props: { open: false } })

    expect(fetch).not.toHaveBeenCalled()
    expect(body().find('[role="dialog"]').exists()).toBe(false)
  })
})
