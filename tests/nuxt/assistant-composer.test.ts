import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AssistantComposer from '~/components/assistant/Composer.vue'
import { ASSISTANT_MESSAGE_IMAGES_MAX } from '~~/shared/assistant-chat'

// Covers review finding #15's Composer gap: the image-count limit message, that
// `canSend` (and so the Send button) is false while an image is still being
// processed (#8), and Enter/Shift+Enter behaving as send/newline.

type Component = Awaited<ReturnType<typeof mountSuspended>>

function findButton(component: Component, label: string) {
  return component.findAll('button').find((button: DOMWrapper<Element>) => button.text().includes(label))
}

function sendButton(component: Component) {
  return findButton(component, 'Senden')
}

/** happy-dom has no real canvas 2D support (`getContext('2d')` is `null`) —
 * stub it so `resizeImageToDataUrl` (Composer.vue) can run to completion. */
function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAA')
}

function fakeBitmap() {
  return { width: 10, height: 10, close: vi.fn() }
}

function fileInputOf(component: Component) {
  return component.find('input[type="file"]')
}

async function selectFiles(component: Component, files: File[]) {
  const input = fileInputOf(component)
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
}

function pngFile(name: string) {
  return new File(['x'], name, { type: 'image/png' })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AssistantComposer', () => {
  it('rejects one image over the limit with a German error once the cap is already attached', async () => {
    stubCanvas()
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(fakeBitmap())))

    const component = await mountSuspended(AssistantComposer)

    const atCap = Array.from({ length: ASSISTANT_MESSAGE_IMAGES_MAX }, (_, i) => pngFile(`${i}.png`))
    await selectFiles(component, atCap)
    await flushPromises()
    expect(component.findAll('img').length).toBe(ASSISTANT_MESSAGE_IMAGES_MAX)
    expect(component.text()).not.toContain('höchstens')

    await selectFiles(component, [pngFile('one-too-many.png')])
    await flushPromises()

    expect(component.text()).toContain(`Es sind höchstens ${ASSISTANT_MESSAGE_IMAGES_MAX} Bilder pro Nachricht erlaubt.`)
    // Still only the cap's worth — the extra one was never added.
    expect(component.findAll('img').length).toBe(ASSISTANT_MESSAGE_IMAGES_MAX)
  })

  it('disables Senden while an image is still being processed, and re-enables it once done (#8)', async () => {
    stubCanvas()
    let resolveBitmap: (bitmap: unknown) => void = () => {}
    const bitmapPromise = new Promise((resolve) => { resolveBitmap = resolve })
    vi.stubGlobal('createImageBitmap', vi.fn(() => bitmapPromise))

    const component = await mountSuspended(AssistantComposer)
    await component.find('textarea').setValue('Karte hinzufügen')
    expect(sendButton(component)!.attributes('disabled')).toBeUndefined()

    await selectFiles(component, [pngFile('a.png')])
    await flushPromises()

    // The image is still being resized (createImageBitmap hasn't resolved
    // yet) — sending now would silently drop it (images: []).
    expect(sendButton(component)!.attributes('disabled')).toBeDefined()

    resolveBitmap(fakeBitmap())
    await flushPromises()

    expect(sendButton(component)!.attributes('disabled')).toBeUndefined()
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const component = await mountSuspended(AssistantComposer)
    const textarea = component.find('textarea')
    await textarea.setValue('Hallo Assistent')

    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(component.emitted('send')).toBeUndefined()

    await textarea.trigger('keydown', { key: 'Enter' })
    expect(component.emitted('send')).toEqual([[{ text: 'Hallo Assistent', images: [] }]])
  })

  it('shows "Wird abgebrochen…" and disables the button while cancelling', async () => {
    const component = await mountSuspended(AssistantComposer, { props: { streaming: true, cancelling: true } })

    const cancelButton = findButton(component, 'Wird abgebrochen')
    expect(cancelButton).toBeTruthy()
    expect(cancelButton!.attributes('disabled')).toBeDefined()
  })
})
