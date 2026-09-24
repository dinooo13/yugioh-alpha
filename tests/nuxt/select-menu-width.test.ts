import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { USelect, USelectMenu } from '#components'

// #134: every select's open menu grows to fit its longest option (app.config
// `select` / `selectMenu` slots) instead of being locked to the field's
// width, and option labels wrap instead of being cut off with an ellipsis.

const LONG_LABEL = 'Legendary Duelists: Soulburning Volcano – Special Edition Booster Box Set'

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
})

async function openMenu(component: typeof USelect | typeof USelectMenu) {
  const wrapper = await mountSuspended(component, {
    props: {
      items: [{ label: LONG_LABEL, value: 'long' }, { label: 'Kurz', value: 'short' }],
      defaultOpen: true,
      portal: false,
    },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('select menu width (#134)', () => {
  it.each([
    ['USelect', USelect, 'select'],
    ['USelectMenu', USelectMenu, 'combobox'],
  ] as const)('%s: the menu is as wide as its options, at least the field, and labels are not truncated', async (_name, component, reka) => {
    await openMenu(component)

    const content = document.querySelector('[data-slot="content"]')
    expect(content).not.toBeNull()
    const classes = [...content!.classList]
    expect(classes).toContain('w-auto')
    expect(classes).toContain(`min-w-(--reka-${reka}-trigger-width)`)
    expect(classes).toContain('max-w-[min(32rem,calc(100vw-2rem))]')
    expect(classes).not.toContain('w-(--reka-select-trigger-width)')
    expect(classes).not.toContain('w-(--reka-combobox-trigger-width)')

    const label = [...document.querySelectorAll('[data-slot="itemLabel"]')]
      .find(element => element.textContent?.trim() === LONG_LABEL)
    expect(label).toBeDefined()
    expect(label!.classList).not.toContain('truncate')
    expect(label!.classList).toContain('break-words')
  })
})
