// The Comark parser for the assistant's answers (docs/adr/0023-markdown-in-assistant-answers.md).
//
// Loaded on demand by `createAssistantMarkdownParser` so comark, htmlparser2,
// entities and js-yaml land in their own async chunk (#148). Don't import this
// module statically.
//
// Comark runs with its default plugins off — no raw HTML (it stays literal
// text), no `::component` / `:inline{}` syntax, no `{attributes}`, no
// frontmatter, no alerts or task lists. What's left is CommonMark plus GFM
// tables and strikethrough. The security plugin then keeps only the allowed
// tags, protocol-checks links and drops images (their alt text stays).

import { createSerializedMarkdownParser } from 'comark'
import type { ElementNode, Node } from 'comark'
import breaks from 'comark/plugins/breaks'
import security from 'comark/plugins/security'
import { textContent } from 'comark/utils'
import { ASSISTANT_MARKDOWN_TAGS } from './assistant-markdown'
import type { AssistantMarkdownParser } from './assistant-markdown'

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
export function createComarkAssistantParser(): AssistantMarkdownParser {
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
