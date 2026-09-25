import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CardThumb from '~/components/card/CardThumb.vue'
import CardTypeChip from '~/components/card/CardTypeChip.vue'
import AttributeOrb from '~/components/card/AttributeOrb.vue'
import FrameDot from '~/components/card/FrameDot.vue'
import { setTestLocale } from './fixtures/locale'

// Duel Arena card accents (ADR 0016): decorative frame and attribute colors
// next to text that always says the same thing.

afterEach(() => setTestLocale('de'))

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

describe('CardTypeChip', () => {
  it('writes the type in the card language next to a decorative frame dot', async () => {
    const component = await mountSuspended(CardTypeChip, {
      props: { type: 'Pendulum Effect Monster', frameType: 'effect_pendulum' },
    })

    expect(component.text()).toBe('Pendel-Effektmonster')
    expect(component.attributes('data-frame')).toBe('effect')
    expect(component.attributes('data-pendulum')).toBeDefined()
    expect(component.find('.frame-dot').attributes('aria-hidden')).toBe('true')
  })

  it('follows an English card language', async () => {
    await setTestLocale('en')
    const component = await mountSuspended(CardTypeChip, { props: { type: 'Spell Card' } })

    expect(component.text()).toBe('Spell Card')
    expect(component.attributes('data-frame')).toBe('spell')
    expect(component.attributes('data-pendulum')).toBeUndefined()
  })
})

describe('AttributeOrb', () => {
  it('writes the attribute in the card language next to a decorative orb', async () => {
    const component = await mountSuspended(AttributeOrb, { props: { attribute: 'DARK' } })

    expect(component.text()).toBe('FINSTERNIS')
    expect(component.attributes('data-attribute')).toBe('dark')
    expect(component.find('.attribute-orb').attributes('aria-hidden')).toBe('true')
  })

  it('shows an unknown attribute as stored, without an orb color', async () => {
    const component = await mountSuspended(AttributeOrb, { props: { attribute: 'LAUGH' } })

    expect(component.text()).toBe('LAUGH')
    expect(component.attributes('data-attribute')).toBeUndefined()
  })
})

describe('FrameDot', () => {
  it('is a hidden dot in the frame color, or nothing without a type', async () => {
    const dot = await mountSuspended(FrameDot, { props: { type: 'Link Monster' } })
    expect(dot.attributes('data-frame')).toBe('link')
    expect(dot.attributes('aria-hidden')).toBe('true')

    const none = await mountSuspended(FrameDot, { props: { type: null } })
    expect(none.find('.frame-dot').exists()).toBe(false)
  })
})

describe('CardThumb accents', () => {
  it('uses the arcane card back as the placeholder, striped in the frame color', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: null, frame: 'normal', size: 'lg' },
    })

    const placeholder = component.find('[role="img"]')
    expect(placeholder.classes()).toContain('card-back')
    expect(placeholder.attributes('data-frame')).toBe('normal')
    expect(placeholder.find('.frame-stripe').attributes('aria-hidden')).toBe('true')
    // The label is still spelled out.
    expect(placeholder.text()).toContain('Kein Bild')
  })

  it('only adds the foil sheen over a real scan', async () => {
    const withImage = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: 'https://images.example/46986414.jpg', foil: true },
    })
    expect(withImage.find('img').element.parentElement!.classList).toContain('foil')

    const withoutImage = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: null, foil: true },
    })
    expect(withoutImage.find('.foil').exists()).toBe(false)
  })
})
