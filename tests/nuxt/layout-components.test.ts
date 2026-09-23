import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PageHeader from '~/components/layout/PageHeader.vue'
import BackLink from '~/components/layout/BackLink.vue'
import EmptyState from '~/components/layout/EmptyState.vue'
import SkipLink from '~/components/layout/SkipLink.vue'

describe('LayoutPageHeader', () => {
  it('renders the title as the only h1, the description and the actions', async () => {
    const component = await mountSuspended(PageHeader, {
      props: { title: 'Decks', description: '3 Decks' },
      slots: { actions: () => h('button', { type: 'button' }, 'Neues Deck') },
    })

    expect(component.findAll('h1')).toHaveLength(1)
    expect(component.find('h1').text()).toBe('Decks')
    expect(component.find('h2').exists()).toBe(false)
    expect(component.find('p').text()).toBe('3 Decks')
    expect(component.find('button').text()).toBe('Neues Deck')
  })

  it('omits the description and action wrappers when unused', async () => {
    const component = await mountSuspended(PageHeader, {
      props: { title: 'Katalog', truncate: true },
    })

    expect(component.find('p').exists()).toBe(false)
    expect(component.find('h1').classes()).toContain('truncate')
    expect(component.findAll('header > div')).toHaveLength(1)
  })

  it('accepts slot content for title and description', async () => {
    const component = await mountSuspended(PageHeader, {
      slots: {
        title: () => 'Inventar von Fabian',
        description: () => h('span', '4 Karten insgesamt'),
      },
    })

    expect(component.find('h1').text()).toBe('Inventar von Fabian')
    expect(component.find('p').text()).toBe('4 Karten insgesamt')
  })
})

describe('LayoutBackLink', () => {
  it('links back with exactly the label as its text and a decorative arrow', async () => {
    const component = await mountSuspended(BackLink, {
      props: { to: '/decks', label: 'Zurück zu den Decks' },
    })

    const link = component.find('a')
    expect(link.attributes('href')).toBe('/decks')
    expect(link.text()).toBe('Zurück zu den Decks')
    expect(link.find('[aria-hidden="true"]').exists()).toBe(true)
  })
})

describe('LayoutEmptyState', () => {
  it('renders an h2 heading, description, icon and actions by default', async () => {
    const component = await mountSuspended(EmptyState, {
      props: { title: 'Noch keine Decks', description: 'Lege dein erstes Deck an.', icon: 'i-lucide-layers' },
      slots: { actions: () => h('button', { type: 'button' }, 'Neues Deck') },
    })

    expect(component.find('h2').text()).toBe('Noch keine Decks')
    expect(component.find('h3').exists()).toBe(false)
    expect(component.find('p').text()).toBe('Lege dein erstes Deck an.')
    expect(component.find('[aria-hidden="true"]').exists()).toBe(true)
    expect(component.find('button').text()).toBe('Neues Deck')
    expect(component.classes()).toContain('border')
  })

  it('supports an h3 heading, a description slot and no border', async () => {
    const component = await mountSuspended(EmptyState, {
      props: { title: 'Noch keine eigenen Formate', headingLevel: 3, bordered: false },
      slots: {
        description: () => h('strong', 'Leg eins an'),
        default: () => h('span', { class: 'extra' }, 'Extra'),
      },
    })

    expect(component.find('h3').text()).toBe('Noch keine eigenen Formate')
    expect(component.find('h2').exists()).toBe(false)
    expect(component.find('p strong').text()).toBe('Leg eins an')
    expect(component.find('.extra').exists()).toBe(true)
    expect(component.classes()).not.toContain('border')
  })
})

describe('LayoutSkipLink', () => {
  it('points at the main content with a German default label', async () => {
    const component = await mountSuspended(SkipLink)

    expect(component.attributes('href')).toBe('#main-content')
    expect(component.text()).toBe('Zum Inhalt springen')
    expect(component.classes()).toContain('sr-only')
  })

  it('moves focus to the target on activation', async () => {
    const target = document.createElement('main')
    target.id = 'content'
    target.tabIndex = -1
    document.body.appendChild(target)

    const component = await mountSuspended(SkipLink, {
      props: { label: 'Skip', target: 'content' },
    })
    expect(component.attributes('href')).toBe('#content')

    await component.trigger('click')

    expect(document.activeElement).toBe(target)
    target.remove()
  })
})
