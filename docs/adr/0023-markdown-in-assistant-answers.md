# 0023: Markdown in assistant answers

## Status

Accepted (#123).

## Context

The assistant's models (MiMo V2.6 Pro and others, [ADR 0020](0020-assistant-on-the-ai-sdk.md))
answer in Markdown: comparison tables, headings, numbered lists, inline code.
`MessageText.vue` only knew paragraphs, `- ` lists and `**bold**`
(`app/utils/assistant-message.ts`), so a table arrived as raw `|` rows and
headings as `##` text. The #84 plan kept that small renderer on purpose: it
could never produce markup, because it only fed plain strings into `{{ }}`.

Nuxt UI 4.11 (upgraded in the same PR, #86) renders chat text with Comark in
its docs: `@comark/nuxt` and `<Markdown :value :streaming>`. Comark is the
Nuxt team's successor of `@nuxtjs/mdc`, which is now "MDC (legacy)".

## Decision

1. **Comark core as the parser.** `comark` (`^0.7`), used directly in
   `app/utils/assistant-markdown.ts`, without the Nuxt module:
   `createSerializedMarkdownParser` with
   - `registerDefaultPlugins: false`: no raw HTML (it stays literal text), no
     `::component` / `:inline{}` syntax, no `{attributes}`, no frontmatter,
     no alerts or task lists. What's left is CommonMark with GFM tables and
     strikethrough;
   - `headingIds: false`: no `id`s that repeat across messages or clobber
     DOM globals;
   - `breaks`: a single newline is a line break, as in a chat;
   - the `security` plugin: an allow-list of tags (`p br strong em del s code
     pre a ul ol li blockquote hr h1–h6 table thead tbody tr th td`), links
     only with `http`, `https` or `mailto` (plus relative paths), no data
     images, and a fallback that keeps a dropped tag's text. Images are
     never rendered; their alt text stays.
2. **Our own render function, not `@comark/vue`.** The sanitized tree is
   turned into VNodes by a small function in the same file. Every allowed
   tag becomes a plain element with compact classes from the Duel Arena
   semantic tokens; only a few attributes pass (a link's `href`/`title`, a
   cell's GFM `text-align`, an ordered list's `start`); any other tag renders
   just its children. `@comark/vue`'s `<Markdown>` and `<MarkdownDocument>`
   both have an async `setup` (they need a `<Suspense>` boundary) and resolve
   tags to globally registered app components (`Prose*`, PascalCase tag
   names) — neither is wanted here.
3. **Links.** A path (`/decks`) becomes a `NuxtLink`; a `#` anchor a plain
   link; anything else (including `//host`) opens in a new tab with
   `rel="noopener noreferrer nofollow"`. A link whose `href` the security
   plugin dropped renders as text.
4. **Tables** sit in a wrapper that scrolls sideways (`overflow-x-auto`) and
   is keyboard-focusable (`tabindex="0"`, axe `scrollable-region-focusable`),
   so a wide table never widens the page on a phone.
5. **Streaming.** One serialized parser per text part. The part's state
   (`streaming` while the turn runs) is passed on, so Comark closes a
   half-written `**bold` or table row while tokens arrive and reuses the
   already parsed blocks. Parsing is async: the plain text shows until the
   first parse is done (and on the server), a newer parse keeps the previous
   document visible until it's ready, and a failed parse falls back to the
   plain text.
6. **User messages stay plain text**, exactly as typed. Never `v-html`.
7. **No syntax highlighting** (no Shiki) and no Nuxt UI prose components.

## Alternatives considered

- **`@nuxtjs/mdc`**: legacy, heavier (unified, rehype-raw, Shiki), and it
  parses raw HTML by default.
- **`@comark/nuxt` with Nuxt UI's prose components** (what the Nuxt UI chat
  docs show): it switches `ui.prose` on, which registers about 50 global
  `Prose*` components sized for docs pages (`p my-5`, `h1 text-4xl`, heading
  anchors). They'd need a dozen compact overrides in `app.config.ts`, and any
  global component could be reached from a Markdown tag.
- **markdown-it + DOMPurify + `v-html`**: breaks the `no-v-html` rule and
  the guarantee that answer text never becomes markup the browser parses.
- **Extending our own parser**: tables, nested lists, code and links are
  exactly the cases where a hand-written parser grows edge cases.

## Consequences

- A new pre-1.0 dependency: `comark` `^0.7`, which pins `markdown-exit`
  `1.1.0-beta.2` (a markdown-it fork) and imports `htmlparser2`, `entities`
  and `js-yaml` statically even though their plugins are off. The assistant
  route chunk grows from 61.8 kB to 164.2 kB gzipped; the entry chunk doesn't
  change (MessageText is only used on `/assistant`).
- Answers with tables, headings and code read as intended. The system prompt
  doesn't restrict formatting, so it could now ask for tables explicitly in
  comparisons.
- A user's own message no longer shows `**bold**` or `- ` lists as
  formatting.
- The async parse can leave the previous document visible for one tick; it
  is always safe text.
- The tag allow-list (`ASSISTANT_MARKDOWN_TAGS`, used by the parser and the
  renderer) and the renderer's per-tag attributes are the security boundary.
  Widening either needs a test in `tests/nuxt/assistant-message-text.test.ts`.
