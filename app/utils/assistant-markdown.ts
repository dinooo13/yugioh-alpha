// The assistant's answers as sanitized Markdown (docs/adr/0023-markdown-in-assistant-answers.md).
//
// Parsing: Comark (the Nuxt team's successor of @nuxtjs/mdc) with its default
// plugins off — no raw HTML (it stays literal text), no `::component` /
// `:inline{}` syntax, no `{attributes}`, no frontmatter, no alerts or task
// lists. What's left is CommonMark plus GFM tables and strikethrough. The
// security plugin then keeps only the tags below, protocol-checks links and
// drops images (their alt text stays).
//
// Rendering: our own small render function over the sanitized tree — every
// allowed tag maps to a plain element with Duel Arena semantic classes, only
// a few attributes per tag pass, and any other tag renders just its
// children. It never uses `v-html` and never resolves a tag to a registered
// app component.

import { createSerializedMarkdownParser } from 'comark'
import type { ComarkParseFn, ElementNode, MarkdownDocument, Node } from 'comark'
import breaks from 'comark/plugins/breaks'
import security from 'comark/plugins/security'
import { textContent } from 'comark/utils'
import { defineComponent, Fragment, h } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { NuxtLink } from '#components'

export type AssistantMarkdownDocument = MarkdownDocument
export type AssistantMarkdownParser = ComarkParseFn

/** The only tags an answer may contain. No `img`, `input`, `span` or `div`. */
export const ASSISTANT_MARKDOWN_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'a',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
] as const

type AssistantMarkdownTag = typeof ASSISTANT_MARKDOWN_TAGS[number]

const ALLOWED_TAGS = new Set<string>(ASSISTANT_MARKDOWN_TAGS)

/** A tag outside the allow-list keeps its text; an image keeps its alt text. */
function tagFallback(element: ElementNode): false | Node {
  if (element[0].toLowerCase() === 'img') {
    const alt = element[1].alt
    return typeof alt === 'string' && alt.trim() !== '' ? alt : false
  }
  return textContent(element)
}

/**
 * One parser per text part: the serialized parser runs parses in order and
 * keeps the incremental state of a streaming part (`{ streaming: true }`
 * closes a half-written `**bold` or table while tokens arrive).
 */
export function createAssistantMarkdownParser(): AssistantMarkdownParser {
  return createSerializedMarkdownParser({
    registerDefaultPlugins: false,
    // Headings get no `id`s: they would repeat across messages and could
    // clobber DOM globals.
    headingIds: false,
    autoClose: true,
    linkify: true,
    plugins: [
      breaks(),
      security({
        allowedTags: [...ASSISTANT_MARKDOWN_TAGS],
        allowedProtocols: ['http', 'https', 'mailto'],
        allowDataImages: false,
        tagFallback,
      }),
    ],
  })
}

// --- Rendering ------------------------------------------------------------------

const LINK_CLASS = 'text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * Compact styles for a `text-sm leading-6` bubble, semantic tokens only.
 * Lines use `accented`: the bubble is `bg-elevated`, which `border-default`
 * matches in dark mode.
 */
const TAG_CLASS: Partial<Record<AssistantMarkdownTag, string>> = {
  h1: 'text-base font-semibold text-highlighted',
  h2: 'text-base font-semibold text-highlighted',
  h3: 'text-sm font-semibold text-highlighted',
  h4: 'text-sm font-semibold text-highlighted',
  h5: 'text-sm font-semibold text-highlighted',
  h6: 'text-sm font-semibold text-highlighted',
  strong: 'font-semibold text-highlighted',
  ul: 'list-disc ps-5 space-y-1 marker:text-muted',
  ol: 'list-decimal ps-5 space-y-1 marker:text-muted',
  li: '[&>ul]:mt-1 [&>ol]:mt-1',
  blockquote: 'border-s-2 border-secondary/60 ps-3 text-muted',
  hr: 'border-accented',
  code: 'rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.8125rem] text-highlighted ring-1 ring-default',
  pre: 'overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 ring-1 ring-default whitespace-pre',
  table: 'w-full border-collapse text-xs sm:text-sm',
  thead: 'bg-muted',
  th: 'px-2.5 py-1.5 text-start font-semibold text-highlighted border-b border-accented',
  td: 'px-2.5 py-1.5 align-top border-t border-accented/60',
}

const TABLE_WRAPPER_CLASS = 'overflow-x-auto rounded-lg ring-1 ring-accented focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** GFM column alignment is the only style an answer can carry. */
const ALIGNMENT = /^text-align:\s*(?:left|right|center)$/

/** Same-origin paths (`/decks`), but not protocol-relative ones (`//host`, `/\host`). */
const INTERNAL_PATH = /^\/(?![/\\])/

/** Keeps a cell's alignment; right-aligned (numeric) columns get tabular digits. */
function cellAttrs(attrs: Record<string, unknown>): { style?: string, class?: string } {
  const style = typeof attrs.style === 'string' ? attrs.style.trim() : ''
  if (!ALIGNMENT.test(style)) {
    return {}
  }
  return { style, class: style.endsWith('right') ? 'tabular-nums' : undefined }
}

function renderLink(attrs: Record<string, unknown>, children: () => VNodeChild[]): VNodeChild {
  // The security plugin has already dropped an unsafe `href`.
  const href = typeof attrs.href === 'string' ? attrs.href : ''
  const title = typeof attrs.title === 'string' ? attrs.title : undefined
  if (href === '') {
    return h('span', children())
  }
  if (INTERNAL_PATH.test(href)) {
    return h(NuxtLink, { to: href, title, class: LINK_CLASS }, { default: children })
  }
  if (href.startsWith('#')) {
    return h('a', { href, title, class: LINK_CLASS }, children())
  }
  return h('a', { href, title, class: LINK_CLASS, target: '_blank', rel: 'noopener noreferrer nofollow' }, children())
}

function renderNode(node: Node, key: number, inPre: boolean): VNodeChild {
  if (typeof node === 'string') {
    return node
  }
  if (node[0] === null) {
    return null
  }
  const [rawTag, attrs, ...childNodes] = node as ElementNode
  const tag = rawTag.toLowerCase()
  const children = () => childNodes.map((child, index) => renderNode(child, index, inPre || tag === 'pre'))

  if (!ALLOWED_TAGS.has(tag)) {
    return h(Fragment, { key }, children())
  }

  switch (tag as AssistantMarkdownTag) {
    case 'a':
      return h(Fragment, { key }, [renderLink(attrs, children)])
    case 'code':
      // Code inside a block takes the block's look.
      return h('code', { key, class: inPre ? undefined : TAG_CLASS.code }, children())
    case 'table':
      // `tabindex` makes the scrollable wrapper reachable by keyboard (axe
      // `scrollable-region-focusable`).
      return h('div', { key, tabindex: 0, class: TABLE_WRAPPER_CLASS }, [
        h('table', { class: TAG_CLASS.table }, children()),
      ])
    case 'th':
    case 'td': {
      const cell = cellAttrs(attrs)
      return h(tag, { key, style: cell.style, class: [TAG_CLASS[tag as AssistantMarkdownTag], cell.class] }, children())
    }
    case 'ol': {
      const start = Number(attrs.start)
      return h('ol', { key, class: TAG_CLASS.ol, start: Number.isInteger(start) && start !== 1 ? start : undefined }, children())
    }
    case 'br':
    case 'hr':
      return h(tag, { key, class: TAG_CLASS[tag as AssistantMarkdownTag] })
    default:
      return h(tag, { key, class: TAG_CLASS[tag as AssistantMarkdownTag] }, children())
  }
}

/** Renders a parsed, sanitized answer into a `div` (its class falls through). */
export const AssistantMarkdown = defineComponent({
  name: 'AssistantMarkdown',
  props: {
    value: {
      type: Object as PropType<AssistantMarkdownDocument>,
      required: true,
    },
  },
  setup(props) {
    return () => h('div', { 'data-assistant-markdown': '' }, props.value.nodes.map((node, index) => renderNode(node, index, false)))
  },
})
