import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QuantityStepper from '~/components/card/QuantityStepper.vue'

// The shared − / input / + control (#135).

const labels = {
  inputLabel: 'Anzahl in Box 1',
  decreaseLabel: 'Eine Kopie weniger in Box 1',
  increaseLabel: 'Eine Kopie mehr in Box 1',
}

async function mountStepper(props: Record<string, unknown> = {}) {
  const component = await mountSuspended(QuantityStepper, { props: { modelValue: 3, ...labels, ...props } })
  return {
    component,
    decrease: component.find('[aria-label="Eine Kopie weniger in Box 1"]'),
    increase: component.find('[aria-label="Eine Kopie mehr in Box 1"]'),
    input: component.find<HTMLInputElement>('input[aria-label="Anzahl in Box 1"]'),
    emitted: () => (component.emitted('update:modelValue') ?? []).map(args => args[0]),
  }
}

describe('CardQuantityStepper', () => {
  it('labels its controls and shows the value', async () => {
    const { decrease, increase, input } = await mountStepper()

    expect(decrease.exists()).toBe(true)
    expect(increase.exists()).toBe(true)
    expect(input.element.value).toBe('3')
    expect(input.attributes('type')).toBe('number')
  })

  it('− and + emit the value one lower and one higher', async () => {
    const { decrease, increase, emitted } = await mountStepper()

    await decrease.trigger('click')
    await increase.trigger('click')

    expect(emitted()).toEqual([2, 4])
  })

  it('disables − at min and + at max', async () => {
    const atMin = await mountStepper({ modelValue: 1, min: 1 })
    expect(atMin.decrease.attributes('disabled')).toBeDefined()
    expect(atMin.increase.attributes('disabled')).toBeUndefined()

    const atMax = await mountStepper({ modelValue: 999 })
    expect(atMax.increase.attributes('disabled')).toBeDefined()
    expect(atMax.decrease.attributes('disabled')).toBeUndefined()

    // The default min is 0: − at 1 still emits 0 (the editor then asks to remove).
    const atOne = await mountStepper({ modelValue: 1 })
    await atOne.decrease.trigger('click')
    expect(atOne.emitted()).toEqual([0])
  })

  it('emits a typed value on change', async () => {
    const { input, emitted } = await mountStepper()

    await input.setValue('12')
    await input.trigger('change')

    expect(emitted()).toEqual([12])
  })

  it.each(['', 'abc', '2.5', '0', '1000'])('ignores %j and snaps back to the value', async (typed) => {
    const { input, emitted } = await mountStepper({ min: 1 })

    await input.setValue(typed)
    await input.trigger('change')
    await nextTick()

    expect(emitted()).toEqual([])
    expect(input.element.value).toBe('3')
  })

  it('snaps back when the parent doesn\'t take a typed value over', async () => {
    const { input, emitted } = await mountStepper()

    await input.setValue('0')
    await input.trigger('change')
    await nextTick()

    // Emitted (the parent may ask first), but the prop is still 3.
    expect(emitted()).toEqual([0])
    expect(input.element.value).toBe('3')
  })
})
