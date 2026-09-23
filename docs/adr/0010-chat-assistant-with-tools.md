# 0010: Chat assistant with tools

## Status

Accepted — the statement that `/decks/assistent` and the deck editor's "KI-Vorschläge" stay unchanged is superseded by [ADR 0011](0011-deck-assistance-in-chat.md)

## Context

The app had grown three separate, narrow entry points for "let the model
help me", none of which could see or touch the other two:

- `/decks/assistent` and the deck editor's "KI-Vorschläge" panel
  ([ADR 0006](0006-ai-deck-assistant.md),
  [ADR 0009](0009-openai-compatible-assistant-provider.md)): a one-shot
  "build a deck" / "improve this deck" call that returns a fully-formed
  proposal, re-validated and shown as owned/missing suggestions.
- `/inventar/erfassen`'s **Foto** tab: client-side OCR
  ([ADR 0003](0003-client-side-ocr-and-speech-entry.md)) that extracts text
  from a photo and posts it into the same string-matching pipeline as the
  **Liste** tab.
- `/inventar/erfassen`'s **Sprache** tab: the Web Speech API filling the
  same textarea as **Liste**.

Each of these is a dead end: the deck assistant cannot look anything up
beyond the candidate pool it was handed for that one call, and OCR/speech
are just alternative ways to produce a string for the existing matcher —
neither can answer "which cards do I own of this archetype", read a card's
full text, or act on more than one kind of request in one interaction. Every
new "let the model do X" idea would otherwise need its own one-shot
endpoint, its own prompt, and its own trust boundary.

## Decision

### One chat, with tools, instead of three one-shot paths

A new page, `/assistent`, replaces the Foto and Sprache modes of
`/inventar/erfassen` and stands next to (does not replace) the existing
`/decks/assistent` build/improve flow, which stays a specialized,
non-conversational tool for its one job. The chat assistant is a
persisted, multi-turn conversation backed by a small tool layer
(`server/utils/assistant-tools.ts`) covering everything the deck assistant
and the entry pages could each only partly do: search the catalog, read a
card's full detail, search the inventory, list collections/decks/formats,
read and validate a deck, and (as writes) add cards to the inventory,
create a deck, or change a deck's cards. Image input (a card photo) and
voice dictation both live in the chat composer instead of being separate
pages — a photo is just an attachment on a chat turn, handled by the model
identifying the card and confirming it via `search_catalog`, the same tool
a typed question would use.

Tool names are English (`search_catalog`, `get_card`, `search_inventory`,
`list_collections`, `list_decks`, `get_deck`, `list_formats`,
`validate_deck`, `add_to_inventory`, `create_deck`, `update_deck_cards`);
their descriptions and every user-facing label
(`shared/assistant-chat.ts`'s `ASSISTANT_TOOL_LABELS` /
`ASSISTANT_ACTION_KIND_LABELS` / `ASSISTANT_ACTION_STATUS_LABELS`) are
German, matching the rest of the UI.

### Writes never mutate directly — pending actions require confirmation

The three write tools (`add_to_inventory`, `create_deck`,
`update_deck_cards`) never call `addOwnedCardsBulkSync` / `createDeck` /
`upsertDeckCard` themselves. Each one validates its arguments (unknown
catalog ids, a foreign deck/collection, an illegal section — the same
`validate*Input` posture as the rest of the server) and, on success, only
produces a **pending action**: an `assistantAction` row (`kind`, `payload`,
a German one-line `summary`, `status: 'pending'`) plus a tool result telling
the model the proposal is "angelegt, wartet auf Bestätigung" rather than
done. The chat UI renders that as an `ActionCard` with `Übernehmen` /
`Verwerfen` buttons and a status badge (`Wartet auf Bestätigung` /
`Übernommen` / `Verworfen` / `Fehlgeschlagen`). Only `POST
/api/assistant/chat/actions/:id/apply` — a user clicking `Übernehmen` —
re-validates the stored payload and runs the real write utils inside a
transaction; `reject` just marks it `rejected`. A model can never make an
irreversible change on its own, and a pending action a user never resolves
simply sits there rather than expiring silently or auto-applying.

This mirrors the deck assistant's "constrain, then verify" posture (ADR
0006): a model result is a proposal, and the server's own validation — not
the model's output — is what actually protects correctness.

### Provider: a generic `chat()` on top of the existing model abstraction, both send session/agent headers

`DeckAssistantModel` (`server/utils/deck-assistant-model.ts`) gains
`chat(input, handlers): Promise<ChatModelResult>` next to the existing
`generate()`: messages with text and/or `image_url` parts, `tools`,
`tool_choice: 'auto'`, `stream: true`, POSTed to
`${baseUrl}/chat/completions` and parsed as `text/event-stream` (`delta.
content` text chunks, `delta.tool_calls[i]` accumulated by `index`,
concatenating `function.arguments` across chunks). Every request — `chat()`
and the existing `generate()` alike — now sends two headers:
`x-opencode-session: <sessionId>` and `User-Agent: yugioh-alpha/<package
version>` (read once from `package.json`). OpenCode Go (an OpenAI-compatible
gateway backed by the OpenCode subscription, distinct from pay-per-use Zen)
rejects requests that lack the session header; every other OpenAI-compatible
server (OpenAI itself, OpenRouter, Ollama, LM Studio, Zen) simply ignores an
unrecognized header, so sending it unconditionally costs nothing elsewhere.
`sessionId` is the conversation id for chat (stable across every turn and
tool round of that conversation) and a fresh random UUID per call for the
one-shot deck assistant, which has no conversation id of its own.

The fake provider (`NUXT_ASSISTANT_PROVIDER=fake`) gained a deterministic
`chat()` for tests/E2E: a message containing "such"/"suche"/"suchen"/"finde"
(word-boundary matched, so "versuche" or "untersuche" don't false-trigger)
issues `search_catalog` with the text after the keyword, then answers with
the count and names on the next round; "hinzufügen"/"füge" after a prior
search result issues `add_to_inventory` for the first result card at the
quantity found in the text (default 1); an image attachment answers "Auf
dem Bild sehe ich: Dark Magician." and issues `search_catalog({ query:
'Dark Magician' })`; anything else echoes "Testantwort: `<text>`".

### Vision: image parts, with an optional override model

A user turn's images are sent as `image_url` data-URL parts alongside the
text part, on the same `chat()` request — no separate vision endpoint or
pipeline. `NUXT_ASSISTANT_VISION_MODEL` (`runtimeConfig.assistant
.visionModel`, default `''`) lets a deployment point image-containing turns
at a different model than plain-text turns, for a provider where the
configured default model isn't (or isn't as good a) vision model; when
unset, the configured `model` is used for every turn. This was verified
against `glm-5.3-flash` on OpenCode Go, which accepts `image_url` data URLs
directly and answers with the card name (and later, when the recommended
model changed, against `mimo-v2.6-pro`, which does the same). `GET /api/assistant/status` reports
`vision: true` whenever chat is enabled (the model in use is treated as
vision-capable) and, when `visionModel` is configured, echoes it back so the
UI/ops can see which model actually handles image turns.

### What is persisted — no image bytes, and history is trimmed and sanitized

Conversations, messages, and actions are persisted
(`assistantConversation` / `assistantMessage` / `assistantAction`, see
`server/db/schema.ts`), but a message's image bytes are not: only
`attachments: [{ kind: 'image', label }]` (e.g. `"Foto 1"`) is stored, so an
image only ever travels with the one request it was sent in and never
inflates the database or a later prompt. Rebuilding a model call's history
sends the system prompt plus the most recent messages (assistant/user/tool),
capped at 120 messages and ~160,000 characters total, oldest dropped first
once either limit is exceeded — a long-running conversation degrades
gracefully into "the last N exchanges" rather than failing or silently
growing the request without bound. Every tool result the model sees is
independently capped at 60,000 characters, on top of each read tool's own
100-item result cap, so one oversized result can't itself blow the whole
turn's budget.

The system prompt tells the model that card text and user notes surfaced
inside tool results are data, not instructions, and to never follow anything
they contain — the same prompt-injection stance the deck assistant already
takes with pool card text, now made explicit because chat tool results are
a much larger and more varied surface (arbitrary inventory notes, deck
names, card flavor text) than the deck assistant's constrained pool ever
was.

### Loop and request limits

At most 24 tool-calling rounds per user turn
(`getAssistantLimits().maxToolRounds`), a 5-minute wall-clock budget per turn, and
one turn running at a time per user (an in-memory lock, the same pattern
`suggest.post.ts` already used for the deck assistant) — a second message
sent while one is still streaming gets `409`, rather than two turns
interleaving tool calls against the same conversation.

Limits are configurable: the tool-round cap, both history limits, the tool
result budget, the read tools' item cap, and the model call timeout are all
read from `runtimeConfig.assistant.limits` via `getAssistantLimits()`
(`server/utils/assistant-limits.ts`), overridable per deployment through the
six `NUXT_ASSISTANT_LIMITS_*` env vars documented in `.env.example` — a
garbage or missing override falls back to the defaults quoted above.

## Consequences

- **Removed**: the Foto (`tesseract.js` OCR) and Sprache (Web Speech)
  modes of `/inventar/erfassen`, and the `ocrText` path of `POST
  /api/inventory/entry/suggest` — both fully replaced by the chat
  assistant's image/voice input. The `tesseract.js` dependency is removed
  from `package.json` entirely. The Liste (text) mode of
  `/inventar/erfassen` is unchanged, as is `/decks/assistent` and the deck
  editor's "KI-Vorschläge" panel — this ADR adds a fourth surface, it does
  not touch the other three's build/improve behavior.
- Every fact the assistant states about the catalog, inventory, or decks is
  now backed by a tool call the server executed and logged, rather than
  free-form generation — auditable in the persisted conversation itself
  (each tool call/result is a stored `assistantMessage` row, even though
  the UI renders it as an activity chip rather than a bubble).
- The pending-action model means a write always costs the user one extra
  click (`Übernehmen`), even for a request as unambiguous as "add 2 Dark
  Magician" — accepted deliberately, matching the deck assistant's
  save/apply step, since no tool result is trusted enough to write on its
  own.
- Session headers are sent to every configured endpoint unconditionally.
  This is a no-op for providers that don't recognize `x-opencode-session`,
  but it does mean every request now carries one more (non-secret)
  identifying header than before; this was accepted since it is the only
  way to support OpenCode Go without a provider-specific code path. OpenCode
  Go's own terms note that the Go plan is intended for coding-agent use
  (e.g. this app's own development, not for building a third-party product
  on top of it) — worth keeping in mind before pointing a deployed instance
  of this app's assistant at a Go endpoint for end users, as opposed to
  local development.
- Vision quality now depends on the configured model (or `visionModel`
  override); there is no fallback to a dedicated vision-only path if the
  configured model can't actually read images, beyond the German answer it
  gives coming out wrong or refusing.
- History trimming means a very long conversation loses its earliest turns
  from the model's context (though never from what's displayed or stored) —
  the same trade-off as any chat product with a context window, made
  explicit here rather than left as an unbounded-growth bug.

## Supersedes

[ADR 0003](0003-client-side-ocr-and-speech-entry.md) (its Status is marked
"Superseded by ADR 0010"): the client-side-OCR-and-speech decision no
longer applies now that both input modes live in the chat assistant instead
of `/inventar/erfassen`. The Roadmap's Phase 2 note pointing at ADR 0003 for
"photo-based card recognition" is updated to point here instead (see
[`docs/Roadmap.md`](../Roadmap.md)).
