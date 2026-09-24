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
    expect(text).toContain('Level 8')
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

  it('loads nothing while closed', async () => {
    const { fetch } = await mountModal({ props: { open: false } })

    expect(fetch).not.toHaveBeenCalled()
    expect(body().find('[role="dialog"]').exists()).toBe(false)
  })
})
