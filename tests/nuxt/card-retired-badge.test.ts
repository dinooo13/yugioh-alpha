import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CardRetiredBadge from '~/components/card/CardRetiredBadge.vue'

// UPopover teleports its content to <body>.
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
})

enableAutoUnmount(afterEach)

async function openHint(props: Record<string, unknown> = {}) {
  const component = await mountSuspended(CardRetiredBadge, { props, attachTo: document.body })
  const trigger = component.find('[data-testid="card-retired-badge"]')
  expect(trigger.element.tagName).toBe('BUTTON')
  expect(trigger.text()).toBe('Nicht mehr im Katalog')
  expect(body().find('[data-testid="card-retired-hint"]').exists()).toBe(false)

  await trigger.trigger('click')
  return vi.waitFor(() => {
    const hint = body().find('[data-testid="card-retired-hint"]')
    expect(hint.exists()).toBe(true)
    return { hint, trigger }
  })
}

describe('CardRetiredBadge (#107)', () => {
  it('opens the owner hint on click/tap, not only on hover', async () => {
    const { hint, trigger } = await openHint()

    expect(hint.text()).toBe('YGOPRODeck führt diese Karte nicht mehr. Deine Einträge bleiben erhalten, in der Suche taucht sie aber nicht mehr auf.')
    // Reka marks the trigger as a popover trigger.
    expect(trigger.attributes('aria-haspopup')).toBe('dialog')
  })

  it('drops "your entries" from the hint in public views', async () => {
    const { hint } = await openHint({ audience: 'public' })

    expect(hint.text()).toBe('YGOPRODeck führt diese Karte nicht mehr, deshalb taucht sie in der Suche nicht mehr auf.')
  })
})
