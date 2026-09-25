// `?card=` overlays close with Back only onto the entry they pushed (#148).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPreviousHistoryEntry } from '~/utils/history-entry'

afterEach(() => {
  vi.restoreAllMocks()
})

function previousEntry(back: unknown) {
  vi.spyOn(window.history, 'state', 'get').mockReturnValue(back === undefined ? null : { back })
}

describe('isPreviousHistoryEntry', () => {
  it('matches the same path and query, in any key order and encoding', () => {
    const router = useRouter()

    previousEntry('/catalog?q=Dark%20Magician&type=Spell%20Card')
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: { type: 'Spell Card', q: 'Dark Magician' } })).toBe(true)

    previousEntry('/catalog')
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(true)
  })

  it('doesn\'t match another query, another path or a missing entry', () => {
    const router = useRouter()

    previousEntry('/catalog?q=Dark')
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: { q: 'Blue' } })).toBe(false)
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(false)

    // The retired card's link pushed another card: the previous entry still has one.
    previousEntry('/catalog?card=1')
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(false)

    previousEntry('/')
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(false)

    previousEntry(null)
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(false)
    previousEntry(undefined)
    expect(isPreviousHistoryEntry(router, { path: '/catalog', query: {} })).toBe(false)
  })
})
