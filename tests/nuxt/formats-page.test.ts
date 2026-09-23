import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DOMWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import FormatePage from '~/pages/formats/index.vue'
import ConfirmDialog from '~/components/layout/ConfirmDialog.vue'

// `useConfirm()` is backed by a single shared `useState`, resolved by
// `ConfirmDialog` (normally mounted once in `default.vue`) — mounting both
// in the same Nuxt app instance is what makes the promise returned by
// `confirm()` actually settle in a test.
const PageWithConfirmDialog = defineComponent({
  components: { FormatePage, ConfirmDialog },
  template: '<div><FormatePage /><ConfirmDialog /></div>',
})

// UModal teleports its content to <body>, so the confirm dialog's own
// "Bestätigen"/"Abbrechen" buttons are read from there (same pattern as
// share-modal.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

interface RuleFormatListItem {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  ruleCount: number
  updatedAt: string
}

const state = vi.hoisted(() => ({
  formats: { items: [] as RuleFormatListItem[] },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/formats') {
      return { data: ref(state.formats), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useToast', () => {
  return () => ({ add: vi.fn() })
})

function format(overrides: Partial<RuleFormatListItem> = {}): RuleFormatListItem {
  return {
    id: 'tcg-advanced',
    name: 'TCG Advanced',
    description: 'Offizielles Turnierformat',
    isBuiltin: true,
    ruleCount: 5,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('formats page', () => {
  it('renders official and own formats in separate groups', async () => {
    state.formats = {
      items: [
        format(),
        format({ id: 'goat', name: 'GOAT Format', ruleCount: 6 }),
        format({ id: 'own-1', name: 'Nur alte Karten', isBuiltin: false, ruleCount: 2, description: 'Hausregeln' }),
      ],
    }

    const component = await mountSuspended(FormatePage)
    const text = component.text()

    expect(text).toContain('Offizielle Formate')
    expect(text).toContain('Meine Formate')
    expect(text).toContain('TCG Advanced')
    expect(text).toContain('GOAT Format')
    expect(text).toContain('Nur alte Karten')
    expect(text).toContain('2 Regeln')
    expect(text).toContain('Neues Format')

    const links = component.findAll('a').map(link => link.attributes('href'))
    expect(links).toContain('/formats/goat')
    expect(links).toContain('/formats/own-1')
    expect(links).toContain('/formats/new')
  })

  it('offers cloning but never deleting for a built-in format', async () => {
    state.formats = {
      items: [format(), format({ id: 'own-1', name: 'Eigenes', isBuiltin: false, ruleCount: 1 })],
    }

    const component = await mountSuspended(FormatePage)

    expect(component.find('[aria-label="TCG Advanced klonen"]').exists()).toBe(true)
    expect(component.find('[aria-label="TCG Advanced löschen"]').exists()).toBe(false)

    expect(component.find('[aria-label="Eigenes löschen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Eigenes duplizieren"]').exists()).toBe(true)
  })

  it('clones a format and navigates into the copy', async () => {
    state.formats = { items: [format()] }

    const fetchMock = vi.fn((url: string) => (
      url.startsWith('/api/formats/')
        ? Promise.resolve({ id: 'copy-1', name: 'TCG Advanced (Kopie)' })
        : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(FormatePage)
    await component.find('[aria-label="TCG Advanced klonen"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/api/formats/tcg-advanced/clone', { method: 'POST' })
    vi.unstubAllGlobals()
  })

  it('shows an empty state when the user has no own formats', async () => {
    state.formats = { items: [format()] }

    const component = await mountSuspended(FormatePage)

    expect(component.text()).toContain('Noch keine eigenen Formate')
  })

  it('deletes an own format only after a confirmation', async () => {
    state.formats = { items: [format({ id: 'own-1', name: 'Eigenes', isBuiltin: false, ruleCount: 1 })] }

    const fetchMock = vi.fn((_url: string, _options?: Record<string, unknown>) => Promise.resolve(null))
    vi.stubGlobal('$fetch', fetchMock)

    // Nuxt's session helper uses `$fetch` too — only format calls matter here.
    const formatCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/formats'))

    const component = await mountSuspended(PageWithConfirmDialog)
    await component.find('[aria-label="Eigenes löschen"]').trigger('click')
    await body().findAll('button').find(btn => btn.text() === 'Abbrechen')!.trigger('click')
    expect(formatCalls()).toEqual([])

    await component.find('[aria-label="Eigenes löschen"]').trigger('click')
    await body().findAll('button').find(btn => btn.text() === 'Bestätigen')!.trigger('click')
    expect(fetchMock).toHaveBeenCalledWith('/api/formats/own-1', { method: 'DELETE' })

    vi.unstubAllGlobals()
  })
})
