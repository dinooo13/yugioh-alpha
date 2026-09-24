import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CardThumb from '~/components/card/CardThumb.vue'

const SMALL = 'https://images.example/cards_small/46986414.jpg'
const LARGE = 'https://images.example/cards/46986414.jpg'

// UModal teleports its content to <body>, see share-modal.test.ts.
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CardThumb', () => {
  it('renders a lazy, async, uncropped image of the small scan', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, srcLarge: LARGE },
    })

    const image = component.find('img')
    expect(image.attributes('src')).toBe(SMALL)
    expect(image.attributes('alt')).toBe('Dark Magician')
    expect(image.attributes('loading')).toBe('lazy')
    expect(image.attributes('decoding')).toBe('async')
    expect(image.classes()).toContain('object-contain')
    expect(image.classes()).not.toContain('object-cover')
    // Fixed sizes never need the large scan.
    expect(image.attributes('srcset')).toBeUndefined()

    expect(component.classes()).toContain('w-10')
    // The ratio sits on an inner frame so a stretching flex row can't distort it.
    const frame = image.element.parentElement!
    expect(frame.classList).toContain('aspect-[59/86]')
    expect(frame.classList).not.toContain('rounded-lg')
    expect(component.find('button').exists()).toBe(false)
  })

  it.each([
    ['xs', 'w-8'],
    ['sm', 'w-10'],
    ['md', 'w-12'],
    ['lg', 'w-16'],
    ['full', 'w-full'],
  ] as const)('size %s is %s wide', async (size, widthClass) => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, size },
    })
    expect(component.classes()).toContain(widthClass)
  })

  it('prefers the large scan at full size and offers the small one via srcset', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, srcLarge: LARGE, size: 'full', sizes: '50vw', loading: 'eager' },
    })

    const image = component.find('img')
    expect(image.attributes('src')).toBe(LARGE)
    expect(image.attributes('srcset')).toBe(`${SMALL} 168w, ${LARGE} 421w`)
    expect(image.attributes('sizes')).toBe('50vw')
    expect(image.attributes('loading')).toBe('eager')
  })

  it('falls back to whichever scan exists', async () => {
    const onlyLarge = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', srcLarge: LARGE },
    })
    expect(onlyLarge.find('img').attributes('src')).toBe(LARGE)

    const onlySmall = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, size: 'full' },
    })
    expect(onlySmall.find('img').attributes('src')).toBe(SMALL)
    expect(onlySmall.find('img').attributes('srcset')).toBeUndefined()
  })

  it('shows a labelled placeholder without an image', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: null },
    })

    expect(component.find('img').exists()).toBe(false)
    const placeholder = component.find('[role="img"]')
    expect(placeholder.attributes('aria-label')).toBe('Dark Magician: Kein Bild')
  })

  it('shows the placeholder when the image fails to load', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, size: 'lg', noImageLabel: 'No image' },
    })

    await component.find('img').trigger('error')

    expect(component.find('img').exists()).toBe(false)
    expect(component.find('[role="img"]').attributes('aria-label')).toBe('Dark Magician: No image')
    // Large enough to spell it out.
    expect(component.text()).toContain('No image')
  })

  it('opens the large scan in a modal when enlargeable', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: SMALL, srcLarge: LARGE, enlargeable: true },
    })

    const button = component.find('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('Dark Magician vergrößern')
    // The modal is only mounted on demand.
    expect(body().find(`img[src="${LARGE}"]`).exists()).toBe(false)

    await button.trigger('click')

    await vi.waitFor(() => {
      expect(body().find(`[role="dialog"] img[src="${LARGE}"]`).exists()).toBe(true)
    })
    expect(body().find('[role="dialog"]').text()).toContain('Dark Magician')
    // The enlarged card is the floating one, with the foil sheen (ADR 0016).
    expect(body().find(`[role="dialog"] .foil img[src="${LARGE}"]`).exists()).toBe(true)
  })

  it('is not a button when enlargeable but without an image', async () => {
    const component = await mountSuspended(CardThumb, {
      props: { alt: 'Dark Magician', src: null, enlargeable: true, enlargeLabel: 'Zoom' },
    })

    expect(component.find('button').exists()).toBe(false)
    expect(component.find('[aria-label="Zoom"]').exists()).toBe(false)
  })
})
