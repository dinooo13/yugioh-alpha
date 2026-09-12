import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AssistantPage from '~/pages/decks/assistent.vue'
import type { DeckAssistantResult, DeckAssistantStatus } from '~~/shared/deck-assistant'

const state = vi.hoisted(() => ({
  status: { enabled: true, provider: 'fake', model: 'fake' } as DeckAssistantStatus,
  formats: {
    items: [{ id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true }],
  },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url

    if (resolvedUrl === '/api/assistant/status') {
      return { data: ref(state.status), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/formats') {
      return { data: ref(state.formats), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useToast', () => {
  return () => ({ add: vi.fn() })
})

function findButton(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return component.findAll('button').find((button: DOMWrapper<Element>) => button.text().includes(label))
}

// happy-dom does not run the implicit form submission that a real browser
// performs when a `type="submit"` button is clicked, so submit the request
// form directly (the page only reacts to the form's `submit` event).
async function submitRequestForm(component: Awaited<ReturnType<typeof mountSuspended>>) {
  await component.find('form').trigger('submit')
  await flushPromises()
}

function buildResult(overrides: Partial<DeckAssistantResult> = {}): DeckAssistantResult {
  return {
    mode: 'build',
    formatId: 'tcg-advanced',
    formatName: 'TCG Advanced',
    playStyle: 'balanced',
    summary: 'Testvorschlag des deterministischen Assistenten (Fake-Modell).',
    deck: {
      main: [
        { catalogCardId: 46986414, name: 'Dark Magician', section: 'main', quantity: 3, owned: 3, reason: 'Testvorschlag' },
      ],
      extra: [],
      side: [],
    },
    changes: [],
    missing: [
      { catalogCardId: 44095762, name: 'Mirror Force', section: 'main', quantity: 1, owned: 0, reason: 'Testvorschlag (fehlt)' },
    ],
    validation: {
      legal: false,
      issues: [
        { severity: 'error', code: 'deck_size_min', section: 'main', message: 'Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.' },
      ],
      cards: {},
    },
    warnings: [],
    model: 'fake',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  state.status = { enabled: true, provider: 'fake', model: 'fake', chat: true, vision: true, visionModel: null }
})

describe('AI deck assistant page', () => {
  it('shows a configuration alert and hides the form when the assistant is disabled', async () => {
    state.status = { enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }

    const component = await mountSuspended(AssistantPage)
    const text = component.text()

    expect(text).toContain('Der KI-Assistent ist nicht konfiguriert.')
    expect(text).toContain('NUXT_ASSISTANT_API_KEY')
    expect(findButton(component, 'Vorschläge erzeugen')).toBeUndefined()
  })

  it('renders a build result with the owned deck proposal and a separate missing section', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/assistant/suggest') {
        return Promise.resolve(buildResult())
      }
      return Promise.resolve(null)
    })
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(AssistantPage)
    expect(findButton(component, 'Vorschläge erzeugen')).toBeTruthy()

    await submitRequestForm(component)

    const text = component.text()
    expect(text).toContain('Testvorschlag des deterministischen Assistenten')
    expect(text).toContain('Main Deck (3)')
    expect(text).toContain('Dark Magician')
    expect(text).toContain('Fehlende Karten')
    expect(text).toContain('Mirror Force')
    // The legality badge must reflect the validation the assistant returned.
    expect(text).toContain('Nicht legal')

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/suggest', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ mode: 'build', playStyle: 'balanced', includeMissing: true }),
    }))
  })

  it('shows an empty hint when nothing is missing', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/assistant/suggest') {
        return Promise.resolve(buildResult({ missing: [] }))
      }
      return Promise.resolve(null)
    })
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(AssistantPage)
    await submitRequestForm(component)

    expect(component.text()).toContain('Keine fehlenden Karten.')
  })
})
