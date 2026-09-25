import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ConfirmDialog from '~/components/layout/ConfirmDialog.vue'
import ShareModal from '~/components/sharing/ShareModal.vue'
import type { ShareState } from '~~/shared/sharing'

// A confirm asked from inside a modal (#146): the share dialog's "Neuen
// Link erzeugen". `useConfirm()` only settles with a `ConfirmDialog`
// mounted in the same app (normally once in `default.vue`), so both are
// mounted together (same pattern as formats-page.test.ts).
const ShareModalWithConfirmDialog = defineComponent({
  components: { ShareModal, ConfirmDialog },
  template: `<div>
    <ShareModal open resource-type="deck" resource-id="deck-1" resource-name="Test Deck" share-path="/players/fabian/decks/deck-1" />
    <ConfirmDialog />
  </div>`,
})

// UModal teleports its content to <body>.
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

// Unmount before the cleanup above (hooks run in reverse).
enableAutoUnmount(afterEach)

function linkState(): ShareState {
  return {
    resourceType: 'deck',
    resourceId: 'deck-1',
    visibility: 'link',
    shareToken: 'abc',
    grants: [],
  }
}

async function mountWithConfirm() {
  const fetchMock = vi.fn((_url: string, _options?: Record<string, unknown>) => Promise.resolve(linkState()))
  vi.stubGlobal('$fetch', fetchMock)
  await mountSuspended(ShareModalWithConfirmDialog)
  // The share state loads from a watcher, not a top-level await.
  await flushPromises()
  return fetchMock
}

function button(label: string) {
  const found = body().findAll('button').find(btn => btn.text() === label)
  expect(found, label).toBeTruthy()
  return found!
}

function confirmDialog() {
  return body().findAll('[role="dialog"]').find(dialog => dialog.text().includes('Alte Links werden dadurch ungültig. Fortfahren?'))
}

function regenerateCalls(fetchMock: Awaited<ReturnType<typeof mountWithConfirm>>) {
  return fetchMock.mock.calls.filter(([, options]) => (options?.body as { regenerateToken?: boolean } | undefined)?.regenerateToken)
}

describe('a confirm from inside the share dialog (#146)', () => {
  it('opens above the share dialog', async () => {
    await mountWithConfirm()

    await button('Neuen Link erzeugen').trigger('click')
    await vi.waitFor(() => {
      expect(confirmDialog()).toBeTruthy()
    })
    // The confirm stacks above the page's modals.
    expect(confirmDialog()!.classes()).toContain('z-[60]')
    // The share dialog stays open underneath, with its link.
    const shareDialog = body().findAll('[role="dialog"]').find(dialog => dialog.text().includes('Deck teilen'))
    expect(shareDialog).toBeTruthy()
    expect(shareDialog!.find<HTMLInputElement>('[aria-label="Freigabe-Link"]').element.value).toContain('token=abc')
  })

  it('regenerates the link after "Bestätigen"', async () => {
    const fetchMock = await mountWithConfirm()

    await button('Neuen Link erzeugen').trigger('click')
    await vi.waitFor(() => {
      expect(confirmDialog()).toBeTruthy()
    })
    await button('Bestätigen').trigger('click')
    await flushPromises()

    expect(regenerateCalls(fetchMock)).toEqual([
      ['/api/sharing/deck/deck-1', { method: 'PUT', body: { regenerateToken: true } }],
    ])
  })

  it('changes nothing after "Abbrechen"', async () => {
    const fetchMock = await mountWithConfirm()

    await button('Neuen Link erzeugen').trigger('click')
    await vi.waitFor(() => {
      expect(confirmDialog()).toBeTruthy()
    })
    await button('Abbrechen').trigger('click')
    await flushPromises()

    expect(regenerateCalls(fetchMock)).toEqual([])
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toEqual([])
  })
})
