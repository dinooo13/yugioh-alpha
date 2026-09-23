# 0006: AI deck assistant

## Status

Superseded by [ADR 0011](0011-deck-assistance-in-chat.md) (model-provider section earlier superseded by [ADR 0009](0009-openai-compatible-assistant-provider.md))

## Context

Phase 5 of the [Roadmap](../Roadmap.md) adds AI deck assistance: suggest a
deck from the user's inventory, explain why cards were selected, optimize for
a play style, identify missing cards separately from owned cards, improve an
existing deck, and adapt a deck to a different rule format. The roadmap is
explicit about the constraint that matters most here: "The AI should be
constrained by inventory and rules, not just generate an idealized deck
list."

Two existing models bound the design. Decks
([ADR 0004](0004-deck-data-model.md)) reference catalog cards, not owned
rows, and availability (`owned`/`usedInDeck`/`shortfall`) is derived at read
time rather than reserved — a deck is a plan, not an allocation. Rule formats
([ADR 0005](0005-rule-format-model.md)) are evaluated by a pure function,
`evaluateDeck(rules, deckCards, cardData)`, and legality is never stored,
only ever recomputed. Any AI-produced deck has to fit both: it can only
"use" cards the way a deck already does (a catalog reference plus a
section/quantity), and its legality is exactly whatever `evaluateDeck` says,
not a separate judgment the model makes.

## Decision

### Core dependency: the official Anthropic SDK, structured JSON output, streaming

The assistant is built on `@anthropic-ai/sdk` (`server/utils/deck-assistant-model.ts`),
calling `client.beta.messages.stream(...).finalMessage()` with
`max_tokens: 64000`, `thinking: { type: 'adaptive' }`, and
`output_config: { effort, format: { type: 'json_schema', schema } }`. The
default model is `claude-opus-5`; `effort` defaults to `'high'` and is
configurable per deployment. `betas: ['server-side-fallback-2026-07-01']`
with `fallbacks: 'default'` only engages when the primary model's safety
classifiers decline the request (`stop_reason: 'refusal'`): the API re-runs
the same request server-side on a fallback model chosen by refusal category,
instead of the caller simply getting a refusal back. It does not cover rate
limits, overload, or 5xx errors — those come back as-is and are mapped by
the server to its own `503`/`502` responses.

Streaming is used purely for output headroom, not for incremental UI
updates: `finalMessage()` waits for the complete response. A non-streaming
call would be liable to time out well before a 60-card deck's worth of
adaptive thinking plus per-card reasons finishes generating at this
`max_tokens`. The server inspects `stop_reason` on the final message — a
lingering `'refusal'` (the fallback also declined) or `'max_tokens'` (the
response was cut off) is mapped to `502` — and otherwise finds the text
content block in the response and parses it as the structured JSON output.

Structured output is a hand-written JSON Schema (`buildAssistantSchema`),
the same pattern the rest of the codebase uses for validation — `zod` is not
a dependency, so the assistant does not introduce one just for this schema.
The schema differs by mode: `build` asks for `{ summary, cards, missing }`,
`improve` for `{ summary, changes, missing }`; both cap the response shape
with `additionalProperties: false` and enums for `section`/`action`.

Rejected: a plain-text or loosely-structured completion parsed with regex or
a best-effort JSON extraction. `output_config.format` constrains generation
itself so the model's output is decoded to match the schema, which means the
server's own validation only has to defend against a *structurally valid but
semantically wrong* response (an id outside the pool, a quantity above the
cap), not against unparsable text.

### Constrain, then verify

The server never lets the model conjure or trust a deck list. Before calling
the model, `buildAssistantPool` (`server/utils/deck-assistant.ts`) computes a
candidate pool: every catalog card the user owns at least one copy of,
carrying both its owned quantity and its *format* cap — the rule engine's
effective per-card maximum (the minimum of the `copies` rule, any
`card_status`, the selected banlist, and every applicable `filter` rule; 3
when no format is in play). A card whose format cap is `0` (forbidden by the
format) is excluded from the pool entirely; `min(formatCap, owned)` is
applied later, when clamping what the model actually picks. The pool is
capped at `ASSISTANT_POOL_MAX = 400` cards; a collection larger than that is
prioritized (cards already in the current deck first, then by owned
quantity, then name) and truncated, with a warning surfaced to the caller
rather than a silent drop.

The model may only pick catalog card ids that appear in this pool for owned
suggestions (`cards`/`changes`). A card it wants but the user doesn't own is
requested by exact English name only, in a separate `missing` array — capped
at `ASSISTANT_MISSING_MAX = 10` — and resolved server-side against the
catalog by an exact, case-insensitive name match; a name that doesn't
resolve is dropped with a warning, never guessed at.

Every field of the model's response is then re-validated regardless of what
the schema already constrained: an id outside the pool is dropped
(`unknownDropped`, surfaced as a warning); the section is corrected through
`isExtraDeckCard`/`normalizeSectionForCard` so an Extra Deck card can never
land in `main` and vice versa; quantities are clamped to
`min(formatCap, owned)` per card, with any excess subtracted from later
entries for that card rather than rejecting the whole response; and
duplicate id+section entries from the model are merged instead of producing
two deck rows. Only after this pipeline does the *existing* `evaluateDeck`
run on the resulting card list, exactly the way it runs on a deck built by
hand — the assistant does not get its own legality logic.

Rejected:

- **Trusting a free-form deck list from the model.** This is precisely what
  the roadmap's constraint rules out — nothing stops a model from suggesting
  a card the user doesn't own, an illegal quantity, or a card in the wrong
  section, and post-hoc rejection of a whole response would make the feature
  unusable on the (common) case of one bad entry among sixty.
- **An agentic tool-use loop where the model searches the catalog itself**
  (a `search_cards` tool, iterated until it assembles a decklist). This would
  let a huge collection be explored without a fixed pool cap, but adds
  materially more latency and cost (multiple round trips per request), is
  harder to test deterministically (tool-call sequences instead of one
  input/output schema), and turns the server's guarantee from "the model can
  only choose from what we handed it" into "the model can only *call tools
  that* return validated data" — a weaker and harder-to-audit boundary. This
  can be revisited if the 400-card pool cap turns out to bind in practice.

### Owned vs. missing stay separate in the result shape

`DeckAssistantResult` (`shared/deck-assistant.ts`) carries owned suggestions
in `deck` (build mode) or `changes` (improve mode), and unowned or
insufficiently-owned suggestions in a distinct `missing` array — never
merged into one list with an "owned" flag. This mirrors the roadmap's
explicit ask to "identify missing cards separately from owned cards" and the
deck detail's existing `owned`/`usedInDeck`/`shortfall` split from ADR 0004:
the UI can render "here's your deck" and "here's what you'd need to buy" as
two distinct panels without re-deriving the split itself.

### Stateless: no persistence, reuse of the existing write paths

Nothing about a suggestion is stored. There is no new table and no
migration for this phase. A `build` suggestion is saved by the caller
posting the result straight to `POST /api/decks`, which now additionally
accepts an optional `cards` array (`validateDeckCreateCardsInput`,
`MAX_DECK_CREATE_CARDS = 100`) so the new deck and its initial card rows are
created atomically in one transaction — no separate "create empty deck, then
add cards" round trip that could leave an empty deck behind on failure. An
`improve` suggestion's `changes` are applied through the existing
`PUT /api/decks/:id/cards` endpoint, one upsert per changed row, exactly as
a manual edit in the deckbuilder would.

Rejected: persisting suggestion history (a table of past prompts/responses
per user or deck). Nothing in the current product asks for "show me what the
assistant suggested last time" or an audit trail, and adding it now would be
speculative — a structural decision (new table, retention policy, privacy
surface) taken well before there's a requirement to hang it on.

### Model abstraction with a deterministic fake for tests

`DeckAssistantModel` (`server/utils/deck-assistant-model.ts`) is a one-method
interface (`generate(input): Promise<unknown>`) with two implementations: an
Anthropic-backed one, and `createFakeModel()`, a deterministic, network-free
stub that builds a plausible response from the same pool data a real model
would see (sorted, capped at the structural limits, staple "missing" cards
filtered to whatever the pool doesn't already own). Unit tests inject either
model directly (`server/utils/deck-assistant.ts`'s `runDeckAssistant` takes
the model as a parameter); E2E runs the whole app with
`NUXT_ASSISTANT_PROVIDER=fake`. This is the same dependency-injection
pattern the catalog fetch already uses in tests — no network call, no
recorded fixtures to keep in sync with a real model's behavior, and a
result that's stable enough to assert on exactly.

Configuration lives in `runtimeConfig.assistant`
(`NUXT_ASSISTANT_PROVIDER` / `NUXT_ASSISTANT_API_KEY` / `NUXT_ASSISTANT_MODEL`
/ `NUXT_ASSISTANT_EFFORT`, see `nuxt.config.ts` and `.env.example`); an empty
`apiKey` falls back to the Anthropic SDK's own `ANTHROPIC_API_KEY` env var.
When no provider resolves (empty config and no key present anywhere), the
feature is disabled: `GET /api/assistant/status` reports
`{ enabled: false }` for the UI to show a configuration notice, and
`POST /api/assistant/suggest` returns `503` rather than pretending to work.

### Prompt caching: a stable, cacheable context block ahead of per-request preferences

The user turn is split into two content blocks instead of one prompt string.
A `context` block — the format and its rules, the current deck (improve
mode), and the candidate pool, all built in a fixed, deterministic order —
carries `cache_control: { type: 'ephemeral' }` and is followed by a small
`prompt` block with the per-request parts: mode, play style, and notes. The
system prompt itself carries no per-request data and is passed as `system`,
uncached (it's short enough that caching it buys nothing).

The pool and format/deck description dominate the token count and don't
change between a retry with a different play style or a rephrased note, so
splitting them out lets repeat requests against the same
deck/format/inventory reuse the cached prefix instead of reprocessing it. The
user's free-text notes are placed in the `prompt` block, explicitly
delimited and described to the model as context/preferences, never as
instructions — the system prompt tells the model to treat notes purely as a
preference signal, the same posture the rest of the app takes toward
user-authored text that reaches a trust boundary.

### Guardrails

- **Per-user in-flight guard**: an in-memory `Set<userId>` in
  `POST /api/assistant/suggest` rejects a second concurrent request from the
  same user with `429`, so a double-click or duplicate submit can't run two
  model calls (and two DB read passes) at once. Module-level and
  process-local is sufficient — nothing here needs to survive a restart or
  be coordinated across processes.
- **Notes are capped at `ASSISTANT_NOTES_MAX = 500` characters**, rejected
  with `400` above that, bounding both the prompt size and the surface for
  prompt-injection-style text.
- **Missing-card suggestions are capped at `ASSISTANT_MISSING_MAX = 10`**,
  independent of the schema's own array-length pressure, so a pathological
  response can't balloon the number of catalog lookups the server performs
  to resolve names.

### Privacy

Using the assistant sends catalog-derived data for the cards the caller owns
(names, types, stats, and similar fields already visible in the app) and
their owned quantities, the current deck and format rules (improve mode),
and the user's free-text notes to the Anthropic API. Nothing else is sent:
no email address, no name, and no user or account id.

## Consequences

- Every request costs real latency (a model round trip, adaptive thinking)
  and money, unlike every other endpoint in the app. This is acceptable for
  an explicit, user-initiated "help me build/improve this deck" action, not
  something triggered incidentally.
- The model's output is non-deterministic between calls (even at the same
  effort), but this is inherently safe: legality is always the *engine's*
  verdict (`evaluateDeck`) on the post-processed result, never the model's
  own claim, so a worse or stranger suggestion is a quality problem, not a
  correctness one.
- The 400-card pool cap is a real trade-off for a very large collection: a
  card outside the prioritized pool cannot be suggested as an owned pick in
  that request (it can still surface as a `missing` request resolved from
  the full catalog). The prioritization (current-deck cards first, then
  highest-owned) keeps the common case unaffected; a collection consistently
  over the cap is future work.
- Because suggestions are stateless and reuse existing deck write paths,
  later phases (sharing, tournaments) need no migration to coexist with it.
- Follow-ups explicitly deferred rather than ruled out: streaming partial
  progress to the UI (the API call itself is now non-streaming from the
  client's point of view, buffered server-side), a suggestion-history table,
  and an agentic tool-use catalog-search loop for collections that outgrow
  the pool cap. Photo/artwork-based card recognition (Phase 2) is unrelated
  and unaffected by any of this.
