import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MessageThread from '~/components/assistant/MessageThread.vue'
import type { AssistantTimelineItem } from '~/utils/assistant-timeline'

// MessageThread.vue sticks to the bottom only while the user is there:
// growth (new rows, streamed text, a card expanding) follows when pinned,
// an upward scroll unpins, scrolling back near the bottom or
// `stickToBottom()` re-pins. happy-dom has no layout, so the thread
// container's scroll metrics are faked below and driven by the test.

const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 }
type Metric = keyof typeof metrics
const METRIC_NAMES: Metric[] = ['scrollHeight', 'clientHeight', 'scrollTop']
const ownDescriptors = new Map<Metric, PropertyDescriptor | undefined>()

function isThread(element: unknown): boolean {
  return element instanceof HTMLElement && element.dataset.testid === 'assistant-thread'
}

function inheritedDescriptor(name: Metric): PropertyDescriptor | undefined {
  let proto: object | null = Object.getPrototypeOf(HTMLElement.prototype)
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (descriptor) {
      return descriptor
    }
    proto = Object.getPrototypeOf(proto)
  }
  return undefined
}

function installScrollMetrics() {
  for (const name of METRIC_NAMES) {
    ownDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
    const fallback = ownDescriptors.get(name) ?? inheritedDescriptor(name)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return isThread(this) ? metrics[name] : fallback?.get?.call(this)
      },
      set(this: HTMLElement, value: number) {
        if (!isThread(this)) {
          fallback?.set?.call(this, value)
          return
        }
        if (name === 'scrollTop') {
          // Like a real browser: clamp to [0, scrollHeight - clientHeight].
          metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight))
        }
      },
    })
  }
}

function restoreScrollMetrics() {
  for (const name of METRIC_NAMES) {
    const descriptor = ownDescriptors.get(name)
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, name, descriptor)
    }
    else {
      Reflect.deleteProperty(HTMLElement.prototype, name)
    }
  }
  ownDescriptors.clear()
}

let resizeCallback: (() => void) | null = null

class FakeResizeObserver {
  constructor(callback: () => void) {
    resizeCallback = callback
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function message(key: string, content: string): AssistantTimelineItem {
  return { type: 'message', key, role: 'assistant', content }
}

const BOTTOM = () => metrics.scrollHeight - metrics.clientHeight

async function mountThread(timeline: AssistantTimelineItem[] = [message('m1', 'Hallo'), message('m2', 'Wie kann ich helfen?')]) {
  const component = await mountSuspended(MessageThread, { props: { timeline } })
  const element = component.find('[data-testid="assistant-thread"]').element as HTMLElement
  return { component, element }
}

/** Grow the content and let the (fake) ResizeObserver report it. */
function grow(by: number) {
  metrics.scrollHeight += by
  resizeCallback?.()
}

function userScrollsTo(element: HTMLElement, scrollTop: number) {
  element.scrollTop = scrollTop
  element.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
  metrics.scrollHeight = 1000
  metrics.clientHeight = 400
  metrics.scrollTop = 0
  resizeCallback = null
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  installScrollMetrics()
})

afterEach(() => {
  restoreScrollMetrics()
  vi.unstubAllGlobals()
})

describe('AssistantMessageThread', () => {
  it('starts scrolled to the bottom on mount', async () => {
    await mountThread()

    expect(metrics.scrollTop).toBe(BOTTOM())
    expect(resizeCallback).not.toBeNull()
  })

  it('follows content growth while pinned', async () => {
    await mountThread()

    grow(300)

    expect(metrics.scrollTop).toBe(BOTTOM())
    expect(metrics.scrollTop).toBe(900)
  })

  it('follows streamed text (same number of rows, longer last row) while pinned', async () => {
    const { component } = await mountThread([message('m1', 'Hallo'), message('streaming-text-1', 'Ich')])

    metrics.scrollHeight += 200
    await component.setProps({ timeline: [message('m1', 'Hallo'), message('streaming-text-1', 'Ich schlage vor, die Karte hinzuzufügen.')] })
    await flushPromises()

    expect(metrics.scrollTop).toBe(BOTTOM())
  })

  it('stays where the user scrolled up to instead of yanking them back down', async () => {
    const { component, element } = await mountThread()

    userScrollsTo(element, 0)
    grow(300)
    await component.setProps({ timeline: [message('m1', 'Hallo'), message('m2', 'Wie kann ich helfen?'), message('m3', 'Noch etwas?')] })
    await flushPromises()

    expect(metrics.scrollTop).toBe(0)
  })

  it('re-pins once the user scrolls back to within 80px of the bottom', async () => {
    const { element } = await mountThread()

    userScrollsTo(element, 0)
    grow(100)
    expect(metrics.scrollTop).toBe(0)

    userScrollsTo(element, BOTTOM() - 50)
    grow(300)

    expect(metrics.scrollTop).toBe(BOTTOM())
  })

  it('stickToBottom() re-pins and jumps to the bottom', async () => {
    const { component, element } = await mountThread()

    userScrollsTo(element, 0)
    grow(100)
    expect(metrics.scrollTop).toBe(0)

    ;(component.vm as unknown as { stickToBottom: () => void }).stickToBottom()
    expect(metrics.scrollTop).toBe(BOTTOM())

    grow(300)
    expect(metrics.scrollTop).toBe(BOTTOM())
  })
})
