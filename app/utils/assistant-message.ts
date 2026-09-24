// Turns an assistant message's plain-text content into a small block/inline
// structure `MessageText.vue` can render with plain Vue interpolation
// (`{{ }}`, always HTML-escaped) — never `v-html`. Only three constructs are
// recognized, matching what the system prompt asks the model to produce:
// paragraphs (blank-line separated), `- ` bullet lists, and `**bold**`
// spans. Anything else (stray markdown, HTML-looking text) is left as
// literal text, which is exactly the point — nothing here is ever
// interpreted as markup.

export interface AssistantTextSegment {
  text: string
  bold: boolean
}

export type AssistantTextBlock =
  | { type: 'paragraph', segments: AssistantTextSegment[] }
  | { type: 'list', items: AssistantTextSegment[][] }

function parseInline(text: string): AssistantTextSegment[] {
  const segments: AssistantTextSegment[] = []
  const boldPattern = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match = boldPattern.exec(text)

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false })
    }
    segments.push({ text: match[1]!, bold: true })
    lastIndex = boldPattern.lastIndex
    match = boldPattern.exec(text)
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false })
  }

  return segments.length > 0 ? segments : [{ text: '', bold: false }]
}

/** Parses message content into paragraph/list blocks. A blank line ends the
 * current paragraph or list; a line starting with `- ` joins (or starts) a
 * list instead of a paragraph. */
export function parseAssistantMessageBlocks(content: string): AssistantTextBlock[] {
  const blocks: AssistantTextBlock[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return
    }
    const text = paragraphLines.join(' ').trim()
    if (text !== '') {
      blocks.push({ type: 'paragraph', segments: parseInline(text) })
    }
    paragraphLines = []
  }

  function flushList() {
    if (listItems.length === 0) {
      return
    }
    blocks.push({ type: 'list', items: listItems.map(item => parseInline(item)) })
    listItems = []
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }
    if (line.startsWith('- ')) {
      flushParagraph()
      listItems.push(line.slice(2).trim())
      continue
    }
    flushList()
    paragraphLines.push(line)
  }
  flushParagraph()
  flushList()

  return blocks
}
