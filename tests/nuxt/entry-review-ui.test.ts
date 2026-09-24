import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EntryReviewTable from '~/components/entry/EntryReviewTable.vue'
import QuickEntryPage from '~/pages/inventory/quick-entry.vue'
import {
  buildBulkEntries,
  chunkBulkEntries,
  createEntryRows,
  summarizeEntryRows,
} from '~/utils/card-entry'
import type { EntryCandidate, EntryRow, EntrySuggestResult } from '~/utils/card-entry'
import { setTestLocale } from './fixtures/locale'

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref({ items: [], allCount: 0 }), pending: ref(false), refresh: vi.fn() })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/inventory/quick-entry', query: {} })
})

mockNuxtImport('useToast', () => {
  return () => ({ add: vi.fn() })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await setTestLocale('de')
})

function candidate(overrides: Partial<EntryCandidate> & { name: string, cardId: number }): EntryCandidate {
  return {
    nameDe: null,
    type: 'Normal Monster',
    frameType: 'normal',
    imageSmall: null,
    score: 1,
    matchedBy: 'exact',
    printings: [],
    ...overrides,
  }
}

function result(
  raw: string,
  candidates: EntryCandidate[],
  input: Partial<EntrySuggestResult['input']> = {},
): EntrySuggestResult {
  return {
    input: { raw, quantity: 1, query: raw, ...input },
    candidates,
  }
}

const exactResult = result('Dark Magician', [
  candidate({ cardId: 46986414, name: 'Dark Magician' }),
])

const setCodeResult = result('SDY-006', [
  candidate({
    cardId: 46986414,
    name: 'Dark Magician',
    matchedBy: 'set_code',
    printings: [
      { id: 'LOB-005', setCode: 'LOB-005', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare' },
      { id: 'SDY-006', setCode: 'SDY-006', setName: 'Starter Deck: Yugi', rarity: 'Ultra Rare' },
    ],
  }),
], { setCode: 'SDY-006', query: 'SDY-006' })

const fuzzyResult = result('Dark Magican', [
  candidate({ cardId: 46986414, name: 'Dark Magician', matchedBy: 'fuzzy', score: 0.88 }),
])

const uncertainResult = result('Magier', [
  candidate({ cardId: 46986414, name: 'Dark Magician', matchedBy: 'contains', score: 0.62 }),
  candidate({ cardId: 38033121, name: 'Dark Magician Girl', matchedBy: 'contains', score: 0.51 }),
])

const noMatchResult = result('Völlig unbekannt', [])

// "Pot of Greed (SDY-006)": the set code resolves to a different card than
// the name, so neither may be trusted.
const conflictResult = result('Pot of Greed (SDY-006)', [
  candidate({ cardId: 46986414, name: 'Dark Magician', matchedBy: 'set_code' }),
  candidate({ cardId: 55144522, name: 'Pot of Greed', matchedBy: 'exact' }),
], { setCode: 'SDY-006', query: 'Pot of Greed' })

async function mountTable(rows: EntryRow[]) {
  return mountSuspended(EntryReviewTable, {
    props: {
      rows,
      collections: [{ id: 'col-1', name: 'Box 1' }],
    },
  })
}

function findButton(component: Awaited<ReturnType<typeof mountTable>>, label: string) {
  return component.findAll('button').find(button => button.text().includes(label))
}

describe('entry row preselection', () => {
  it('preselects certain and high-scoring matches only', () => {
    const [exact, fuzzy, uncertain, noMatch] = createEntryRows([
      exactResult,
      fuzzyResult,
      uncertainResult,
      noMatchResult,
    ])

    expect(exact!.selectedCardId).toBe(46986414)
    expect(fuzzy!.selectedCardId).toBe(46986414)
    expect(uncertain!.selectedCardId).toBeNull()
    expect(noMatch!.selectedCardId).toBeNull()
  })

  it('never preselects when the set code and the name disagree', () => {
    const [row] = createEntryRows([conflictResult])

    expect(row).toMatchObject({ selectedCardId: null, conflict: true })
    expect(summarizeEntryRows([row!])).toMatchObject({ unsicher: 1, sicher: 0 })
  })

  it('preselects the printing that matches a parsed set code', () => {
    const [row] = createEntryRows([setCodeResult])

    expect(row).toMatchObject({ selectedCardId: 46986414, setCode: 'SDY-006', printingId: 'SDY-006' })
  })

  it('gives every row a unique id', () => {
    const rows = createEntryRows([exactResult, exactResult, exactResult])

    expect(new Set(rows.map(row => row.id)).size).toBe(3)
  })

  it('carries the parsed quantity into the row', () => {
    const [row] = createEntryRows([result('3x Dark Magician', exactResult.candidates, { quantity: 3 })])

    expect(row!.quantity).toBe(3)
  })

  it('counts rows by status', () => {
    const rows = createEntryRows([exactResult, fuzzyResult, uncertainResult, noMatchResult])

    expect(summarizeEntryRows(rows)).toEqual({ total: 4, sicher: 2, unsicher: 1, ohneTreffer: 1 })
  })
})

describe('EntryReviewTable', () => {
  it('renders a summary and a status per row', async () => {
    const component = await mountTable(createEntryRows([exactResult, uncertainResult, noMatchResult]))
    const text = component.text()

    expect(text).toContain('3 gesamt')
    expect(text).toContain('1 sicher')
    expect(text).toContain('1 unsicher')
    expect(text).toContain('1 ohne Treffer')
    expect(text).toContain('Dark Magician')
    expect(text).toContain('Kein Treffer')
    expect(text).toContain('Standardwerte')
    expect(text).toContain('Normal Monster · EN · Neuwertig (Near Mint) · Unlimitiert')
  })

  it('explains a contradicting set code on the row', async () => {
    const component = await mountTable(createEntryRows([conflictResult]))

    expect(component.text()).toContain('Set-Code und Name zeigen auf verschiedene Karten')
    expect(findButton(component, 'Alle speichern')!.attributes('disabled')).toBeDefined()
  })

  it('blocks "Alle speichern" while a row is unresolved', async () => {
    const component = await mountTable(createEntryRows([exactResult, uncertainResult]))

    const saveAll = findButton(component, 'Alle speichern')
    expect(saveAll).toBeTruthy()
    expect(saveAll!.attributes('disabled')).toBeDefined()

    // The escape hatch for partially resolved batches is offered instead.
    const saveResolved = findButton(component, 'Nur aufgelöste speichern')
    expect(saveResolved).toBeTruthy()
    expect(saveResolved!.attributes('disabled')).toBeUndefined()
    expect(component.text()).toContain('Es gibt noch offene Zeilen')
  })

  it('enables "Alle speichern" once every row is resolved', async () => {
    const component = await mountTable(createEntryRows([exactResult, setCodeResult]))

    expect(findButton(component, 'Alle speichern')!.attributes('disabled')).toBeUndefined()
    expect(findButton(component, 'Nur aufgelöste speichern')).toBeUndefined()
  })

  it('propagates the Standardwerte to every row without an override', async () => {
    const rows = createEntryRows([exactResult, setCodeResult])
    rows[1]!.language = 'fr'

    const component = await mountTable(rows)
    expect(component.text()).toContain('EN · Neuwertig (Near Mint) · Unlimitiert')
    expect(component.text()).toContain('FR · Neuwertig (Near Mint) · Unlimitiert')

    const vm = component.vm as unknown as { defaults: { language: string, condition: string } }
    vm.defaults.language = 'de'
    vm.defaults.condition = 'played'
    await nextTick()

    expect(component.text()).toContain('DE · Bespielt (Played) · Unlimitiert')
    // The per-row override survives a defaults change.
    expect(component.text()).toContain('FR · Bespielt (Played) · Unlimitiert')
  })

  it('preselects the collection the user came from', async () => {
    const component = await mountSuspended(EntryReviewTable, {
      props: {
        rows: createEntryRows([exactResult]),
        collections: [{ id: 'col-1', name: 'Box 1' }],
        presetCollectionId: 'col-1',
      },
    })

    const vm = component.vm as unknown as { defaults: { collectionId: string } }
    expect(vm.defaults.collectionId).toBe('col-1')
  })

  it('emits nothing and keeps rows untouched until the user saves', async () => {
    const component = await mountTable(createEntryRows([exactResult]))

    expect(component.emitted('saved')).toBeUndefined()
    expect(component.emitted('update:rows')).toBeUndefined()
  })

  it('removes a row through its remove button', async () => {
    const component = await mountTable(createEntryRows([exactResult, noMatchResult]))

    const remove = component.findAll('button').find(button => button.attributes('aria-label')?.includes('entfernen'))
    expect(remove).toBeTruthy()
    await remove!.trigger('click')

    const updates = component.emitted('update:rows') as Array<[EntryRow[]]> | undefined
    expect(updates?.at(-1)?.[0]).toHaveLength(1)
  })

  it('saves in server-sized batches and drops the saved rows', async () => {
    const fetchMock = vi.fn(async () => ({ created: 50, merged: 0 }))
    vi.stubGlobal('$fetch', fetchMock)

    // Row rendering is irrelevant here (and slow at this size) — the batching
    // is what is under test.
    const component = await mountSuspended(EntryReviewTable, {
      props: {
        rows: createEntryRows(Array.from({ length: 52 }, () => exactResult)),
        collections: [],
      },
      global: { stubs: { EntryReviewRow: true } },
    })

    await findButton(component, 'Alle speichern')!.trigger('click')
    await flushPromises()

    // Other globals (icons) share $fetch, so only look at bulk requests.
    const bulkCalls = (fetchMock.mock.calls as unknown as Array<[string, { body: { items: unknown[] } }]>)
      .filter(call => call[0] === '/api/inventory/bulk')
    expect(bulkCalls.map(call => call[1].body.items.length)).toEqual([50, 2])

    const updates = component.emitted('update:rows') as Array<[EntryRow[]]>
    expect(updates.at(-1)?.[0]).toHaveLength(0)
    expect(component.emitted('saved')?.at(-1)).toEqual([{ created: 100, merged: 0 }])
  }, 20_000)

  it('maps per-item errors back to the rows the user sees and keeps them', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw {
        data: {
          statusCode: 400,
          statusMessage: 'Some items are invalid',
          data: {
            code: 'items_invalid',
            errors: [{ index: 1, message: 'quantity must be at most 999', code: 'quantity_too_large', params: { max: 999 } }],
          },
        },
      }
    }))

    const component = await mountTable(createEntryRows([exactResult, setCodeResult]))

    await findButton(component, 'Alle speichern')!.trigger('click')
    await flushPromises()

    const text = component.text()
    // The server's technical English never reaches the UI (ADR 0014).
    expect(text).toContain('Einige Zeilen sind ungültig.')
    expect(text).not.toContain('Some items are invalid')
    // Index 1 of the batch is the second row ("SDY-006"), not "Zeile 2".
    expect(text).toContain('„SDY-006“: Die Anzahl darf höchstens 999 betragen.')
    expect(text).not.toContain('Dark Magician“: Die Anzahl')

    const updates = component.emitted('update:rows') as Array<[EntryRow[]]>
    expect(updates.at(-1)?.[0]).toHaveLength(2)
    expect(component.emitted('saved')).toBeUndefined()
  })
})

describe('bulk payload', () => {
  it('only includes resolved rows and applies defaults plus per-row overrides', () => {
    const rows = createEntryRows([exactResult, setCodeResult, noMatchResult])
    rows[0]!.quantity = 2
    rows[1]!.language = 'de'
    rows[1]!.collectionId = 'col-1'

    const entries = buildBulkEntries(rows, {
      language: 'en',
      condition: 'near_mint',
      edition: 'first',
      collectionId: '__no_collection__',
    })

    expect(entries.map(entry => entry.rowId)).toEqual([rows[0]!.id, rows[1]!.id])
    expect(entries.map(entry => entry.item)).toEqual([
      {
        catalogCardId: 46986414,
        printingId: null,
        collectionId: null,
        quantity: 2,
        language: 'en',
        condition: 'near_mint',
        edition: 'first',
      },
      {
        catalogCardId: 46986414,
        printingId: 'SDY-006',
        collectionId: 'col-1',
        quantity: 1,
        language: 'de',
        condition: 'near_mint',
        edition: 'first',
      },
    ])
  })

  it('splits the payload into batches the endpoint accepts', () => {
    const entries = buildBulkEntries(createEntryRows(Array.from({ length: 120 }, () => exactResult)), {
      language: 'en',
      condition: 'near_mint',
      edition: 'unlimited',
      collectionId: '__no_collection__',
    })

    expect(chunkBulkEntries(entries).map(chunk => chunk.length)).toEqual([50, 50, 20])
  })
})

describe('Schnellerfassung page', () => {
  it('appends to the review queue on every "Karten erkennen"', async () => {
    const fetchMock = vi.fn(async () => ({ results: [exactResult, noMatchResult] }))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(QuickEntryPage)
    const textarea = component.find('textarea')

    await textarea.setValue('Dark Magician\nVöllig unbekannt')
    await component.findAll('button').find(button => button.text().includes('Karten erkennen'))!.trigger('click')
    await flushPromises()

    expect(component.text()).toContain('2 gesamt')

    await component.find('textarea').setValue('Dark Magician\nVöllig unbekannt')
    await component.findAll('button').find(button => button.text().includes('Karten erkennen'))!.trigger('click')
    await flushPromises()

    const suggestCalls = (fetchMock.mock.calls as unknown as Array<[string]>)
      .filter(call => call[0] === '/api/inventory/entry/suggest')
    expect(suggestCalls).toHaveLength(2)
    expect(component.text()).toContain('4 gesamt')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    vi.stubGlobal('$fetch', vi.fn(async () => ({ results: [exactResult, noMatchResult] })))

    const component = await mountSuspended(QuickEntryPage)
    expect(component.text()).toContain('Quick entry')
    expect(component.text()).toContain('Card list')
    expect(component.text()).toContain('Examples: 3x Dark Magician, Dark Magician x3')
    expect(component.text()).toContain('Nothing to check yet')

    await component.find('textarea').setValue('Dark Magician\nVöllig unbekannt')
    await component.findAll('button').find(button => button.text().includes('Recognize cards'))!.trigger('click')
    await flushPromises()

    const text = component.text()
    expect(text).toContain('Check and correct')
    expect(text).toContain('Defaults')
    expect(text).toContain('Printing language')
    expect(text).toContain('2 total')
    expect(text).toContain('1 certain')
    expect(text).toContain('1 without a match')
    expect(text).toContain('No match')
    expect(text).toContain('Dark Magician · Exact 100%')
    expect(text).toContain('Normal Monster · EN · Near Mint · Unlimited')
    expect(text).toContain('Save resolved only')
    expect(text).not.toMatch(/gesamt|sicher|Treffer|Standard|Neuwertig|Zustand|Sammlung/)
  })
})
