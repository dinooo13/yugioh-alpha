// MessageText.vue (docs/adr/0023-markdown-in-assistant-answers.md): the
// assistant's answers render as sanitized Markdown — an allow-list of tags,
// no raw HTML, no Comark components, protocol-checked links, no images —
// and the user's own text stays plain. Never `v-html`.

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MessageText from '~/components/assistant/MessageText.vue'
import { createAssistantMarkdownParser } from '~/utils/assistant-markdown'

type Component = Awaited<ReturnType<typeof mountSuspended>>

// The parser loads lazily (#148); warm its chunk once so the first
// `vi.waitFor` below doesn't race a cold transform.
beforeAll(async () => {
  await import('~/utils/assistant-markdown-parser')
})

async function rendered(component: Component) {
  await flushPromises()
  await vi.waitFor(() => {
    expect(component.find('[data-assistant-markdown]').exists()).toBe(true)
  })
  return component
}

async function mountAnswer(text: string, props: Record<string, unknown> = {}) {
  return rendered(await mountSuspended(MessageText, { props: { text, markdown: true, ...props } }))
}

describe('MessageText (assistant answers as Markdown)', () => {
  it('renders a GFM table inside a focusable scroll wrapper', async () => {
    const component = await mountAnswer('| Karte | ATK |\n|---|---:|\n| Dark Magician | 2500 |')

    const wrapper = component.find('div[tabindex="0"]')
    expect(wrapper.classes()).toContain('overflow-x-auto')
    expect(wrapper.findAll('table > thead th').map((th: DOMWrapper<Element>) => th.text())).toEqual(['Karte', 'ATK'])
    expect(wrapper.findAll('table > tbody td').map((td: DOMWrapper<Element>) => td.text())).toEqual(['Dark Magician', '2500'])
    expect(wrapper.findAll('th')[1]!.attributes('style')).toContain('text-align: right')
  })

  it('renders headings without ids', async () => {
    const component = await mountAnswer('# Titel\n\n## Unter')

    expect(component.find('h1').text()).toBe('Titel')
    expect(component.find('h2').text()).toBe('Unter')
    expect(component.find('h1').attributes('id')).toBeUndefined()
    expect(component.find('h2').attributes('id')).toBeUndefined()
  })

  it('keeps HTML in a code block as literal text', async () => {
    const component = await mountAnswer('```html\n<b>x</b>\n```')

    expect(component.find('pre > code').text()).toContain('<b>x</b>')
    expect(component.find('b').exists()).toBe(false)
    expect(component.find('pre > code').attributes('class')).toBeUndefined()
  })

  it('shows raw HTML as text, never as elements', async () => {
    const component = await mountAnswer('<script>alert(1)</script> und <img src=x onerror=alert(1)>')

    expect(component.text()).toContain('<script>alert(1)</script> und <img src=x onerror=alert(1)>')
    expect(component.find('script').exists()).toBe(false)
    expect(component.find('img').exists()).toBe(false)
    expect(component.html()).not.toContain('<script')
    expect(component.html()).not.toContain('<img')
    expect(component.find('[onerror]').exists()).toBe(false)
  })

  it('does not turn a javascript: link into a link', async () => {
    const component = await mountAnswer('[klick](javascript:alert(1))')

    expect(component.find('a[href^="javascript"]').exists()).toBe(false)
    expect(component.find('a').exists()).toBe(false)
    expect(component.text()).toContain('klick')
  })

  it('opens external links in a new tab without opener or referrer', async () => {
    const component = await mountAnswer('[extern](https://example.com) und https://example.org/x')

    const links = component.findAll('a')
    expect(links.map((link: DOMWrapper<Element>) => link.attributes('href'))).toEqual(['https://example.com', 'https://example.org/x'])
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']))
    }
  })

  it('treats protocol-relative links as external', async () => {
    const component = await mountAnswer('[fremd](//example.com/x)')

    expect(component.find('a').attributes('target')).toBe('_blank')
  })

  it('keeps in-app links in the app', async () => {
    const component = await mountAnswer('[intern](/decks)')

    const link = component.find('a[href="/decks"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('intern')
    expect(link.attributes('target')).toBeUndefined()
  })

  it('shows an image as its alt text only', async () => {
    const component = await mountAnswer('Vorher ![Bild](https://tracker.example/x.png) nachher ![](https://tracker.example/y.png)')

    expect(component.find('img').exists()).toBe(false)
    expect(component.text()).toContain('Bild')
    expect(component.html()).not.toContain('tracker.example')
  })

  it('does not render Comark component syntax', async () => {
    const component = await mountAnswer('::u-button{to="/x"}\nHallo\n::\n\n:u-icon{name="i-lucide-x"}')

    expect(component.find('button').exists()).toBe(false)
    expect(component.find('svg').exists()).toBe(false)
    expect(component.text()).toContain('Hallo')
    expect(component.text()).toContain(':u-icon{name="i-lucide-x"}')
  })

  it('does not swallow a leading frontmatter block', async () => {
    const component = await mountAnswer('---\ntitle: x\n---\nText')

    expect(component.text()).toContain('title: x')
    expect(component.text()).toContain('Text')
  })

  it('closes half-written syntax while streaming, then shows the full text', async () => {
    const component = await mountAnswer('Das ist **fett', { streaming: true })

    expect(component.find('strong').text()).toBe('fett')

    await component.setProps({ text: 'Das ist **fett** und mehr', streaming: false })
    await flushPromises()
    await vi.waitFor(() => {
      expect(component.text()).toContain('Das ist fett und mehr')
    })
    expect(component.find('strong').text()).toBe('fett')
  })

  it('renders lists, emphasis, inline code, quotes and rules with semantic classes', async () => {
    const component = await mountAnswer('- eins\n- *zwei*\n\n1. a\n2. b\n\n> Zitat mit `code`\n\n---\n\n~~weg~~')

    expect(component.findAll('ul > li')).toHaveLength(2)
    expect(component.find('em').text()).toBe('zwei')
    expect(component.findAll('ol > li')).toHaveLength(2)
    expect(component.find('blockquote').text()).toContain('Zitat mit')
    expect(component.find('blockquote code').classes()).toContain('bg-muted')
    expect(component.find('hr').exists()).toBe(true)
    expect(component.find('del').text()).toBe('weg')
  })

  it('turns single line breaks into <br>', async () => {
    const component = await mountAnswer('Zeile eins\nZeile zwei')

    expect(component.find('p br').exists()).toBe(true)
  })

  it('renders the user\'s text plain, exactly as typed', async () => {
    const component = await mountSuspended(MessageText, { props: { text: '**nicht fett**\n- keine Liste' } })
    await flushPromises()

    expect(component.find('[data-assistant-markdown]').exists()).toBe(false)
    expect(component.find('strong').exists()).toBe(false)
    expect(component.find('p').text()).toBe('**nicht fett**\n- keine Liste')
  })
})

describe('createAssistantMarkdownParser', () => {
  it('drops raw HTML, unsafe links and component syntax from the tree', async () => {
    const parse = createAssistantMarkdownParser()
    const doc = await parse('<script>x</script> [a](javascript:alert(1)) [b](vbscript:x) [c](data:text/html,x)\n\n::u-button\nHallo\n::')
    const json = JSON.stringify(doc.nodes)

    expect(json).not.toContain('"script"')
    expect(json).not.toContain('"href":"javascript')
    expect(json).not.toContain('"href":"vbscript')
    expect(json).not.toContain('"href":"data:')
    expect(json).not.toContain('"u-button"')
    expect(json).toContain('Hallo')
  })

  it('keeps only allowed tags', async () => {
    const parse = createAssistantMarkdownParser()
    const doc = await parse('![alt](https://x.example/y.png) - [ ] task')
    const tags = new Set<string>()
    const walk = (node: unknown) => {
      if (Array.isArray(node) && typeof node[0] === 'string') {
        tags.add(node[0])
        node.slice(2).forEach(walk)
      }
    }
    doc.nodes.forEach(walk)

    expect([...tags].filter(tag => !['p'].includes(tag))).toEqual([])
  })
})

describe('createAssistantMarkdownParser (lazy)', () => {
  const realFactory = () => import('~/utils/assistant-markdown-parser').then(module => module.createComarkAssistantParser)

  it('rejects a parse when the parser chunk fails to load, and loads it again on the next parse', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(realFactory)
    const parse = createAssistantMarkdownParser(load)

    await expect(parse('Hallo')).rejects.toThrow('offline')
    const doc = await parse('Hallo')

    expect(load).toHaveBeenCalledTimes(2)
    expect(doc.nodes[0]).toEqual(['p', {}, 'Hallo'])
  })

  it('loads the parser once and answers parses in call order', async () => {
    const load = vi.fn(realFactory)
    const parse = createAssistantMarkdownParser(load)

    const [first, second] = await Promise.all([parse('eins'), parse('**zwei**')])

    expect(load).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(first.nodes)).toContain('eins')
    expect(JSON.stringify(first.nodes)).not.toContain('zwei')
    expect(JSON.stringify(second.nodes)).toContain('"strong"')
    expect(JSON.stringify(second.nodes)).toContain('zwei')
  })

  it('keeps Comark out of the static imports of the route code', () => {
    const staticComarkImport = /^import\s+(?!type\b).*from\s+'comark/m
    const markdownModule = readFileSync('app/utils/assistant-markdown.ts', 'utf8')
    const messageText = readFileSync('app/components/assistant/MessageText.vue', 'utf8')

    expect(markdownModule).not.toMatch(staticComarkImport)
    expect(messageText).not.toMatch(staticComarkImport)
    expect(markdownModule).toContain('import(\'./assistant-markdown-parser\')')
    expect(messageText).not.toContain('createComarkAssistantParser')
  })
})
