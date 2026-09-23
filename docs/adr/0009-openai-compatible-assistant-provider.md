# 0009: OpenAI-compatible assistant provider

## Status

Accepted — the structured-output `generate()` parts are superseded by [ADR 0011](0011-deck-assistance-in-chat.md)

## Context

[ADR 0006](0006-ai-deck-assistant.md) built the AI deck assistant on
`@anthropic-ai/sdk`, calling `client.beta.messages.stream(...)` with
`thinking: { type: 'adaptive' }`, `output_config: { effort, format }`, and a
server-side model fallback. That is one specific vendor's API shape, tied to
one account and one pricing tier. The user wants to run the assistant
against cheaper or self-hosted OpenAI-compatible endpoints instead — for
example OpenRouter (many models, pay-per-token, often cheaper than a direct
Anthropic key), Ollama or LM Studio (local, free, no network egress for the
prompt data described in ADR 0006's Privacy section), or OpenCode Zen. None
of those speak the Anthropic Messages API; all of them speak (or emulate)
the OpenAI Chat Completions API, which is the closest thing this space has
to a common wire format.

Nothing about the *rest* of the assistant changes here: the candidate pool,
the constrain-then-verify pipeline, the owned/missing split, and the
deterministic fake model (ADR 0006) are all provider-agnostic already — they
only depend on `DeckAssistantModel.generate(input): Promise<unknown>`. This
ADR is scoped to that one seam: how `generate` talks to a real model.

## Decision

### Chat Completions over plain `fetch`, no SDK

`createOpenAiCompatibleModel({ baseUrl, apiKey, model, fetch? })`
(`server/utils/deck-assistant-model.ts`) replaces `createAnthropicModel`. It
POSTs `${baseUrl}/chat/completions` (a trailing slash on `baseUrl` is
stripped) with `Authorization: Bearer <apiKey>` — omitted entirely when the
key is empty, so a keyless local server (Ollama, LM Studio) never gets a
bogus header — and a body of
`{ model, messages: [{ role: 'system', content: system }, { role: 'user', content: context + '\n\n' + prompt }], response_format, temperature: 0.2 }`.
No SDK dependency is added: `@anthropic-ai/sdk` is removed from
`package.json` and nothing replaces it — global `fetch` (Node 22+, already
the project's minimum) is enough for one non-streaming POST. The call is
non-streaming, wrapped in a 120s `AbortController` timeout, since the model
abstraction's contract (`generate` resolves with the full parsed object, not
a stream) never needed streaming — ADR 0006's own streaming use was for
output headroom on the Anthropic side, not an API the caller observed.

### A three-step structured-output fallback chain

Not every OpenAI-compatible server supports `response_format: { type:
'json_schema', ... }` (strict JSON Schema-constrained decoding) — smaller or
older-API-version servers only support `json_object` (any valid JSON) or
nothing at all. `generate` tries, in order:

1. `response_format: { type: 'json_schema', json_schema: { name:
   'deck_assistant', schema } }` — the same hand-written schema ADR 0006
   already builds (`buildAssistantSchema`, unchanged).
2. On a `400` or `422` (the shape a server uses to reject an unsupported
   parameter): `response_format: { type: 'json_object' }`, with the schema
   folded into the system prompt as an explicit instruction ("Antworte
   ausschließlich mit einem JSON-Objekt nach diesem Schema: …").
3. On another `400`/`422`: no `response_format` at all, relying on the
   system prompt alone (already instructing JSON-only output, per ADR 0006's
   system prompt).

Any other status code (`401`/`403`/`429`/other non-2xx), a network error, or
a timeout is mapped immediately — on whichever attempt it happens — to the
same German errors ADR 0006 defined, no fallback retry: `401`/`403` → `503`
"KI-Assistent ist nicht korrekt konfiguriert.", `429` → `503` "Der
KI-Assistent ist ausgelastet, bitte später erneut versuchen.", anything else
→ `502` "Der KI-Assistent ist derzeit nicht erreichbar." The API key is
never logged at any point.

Rejected: probing server capability up front (an `OPTIONS`-style capability
check, or a per-`baseUrl` cache of "this endpoint supports json_schema").
That's a second round trip and a piece of state to keep fresh across
deployments; retrying on the actual rejection is one extra request in the
worst case and self-correcting if a server's capabilities change.

### Response parsing: `finish_reason`, string-or-parts content, fenced JSON

`choices[0].message.content` is a string on most servers but an array of
`{ type: 'text', text }` parts on some; both are handled, joined in order.
A ` ``` `/` ```json ` fence around the content (common when a server ignores
`response_format` entirely and the model reverts to markdown habit) is
stripped before `JSON.parse`. `choices[0].finish_reason === 'length'` maps to
the same `502` "zu lang oder unvollständig" ADR 0006 used for a truncated
Anthropic response; `'content_filter'` maps to the same `502` "abgelehnt"
ADR 0006 used for a `stop_reason: 'refusal'`. Unparsable JSON after all of
the above is `502` "Ungültige Antwort des Assistenten." — the same posture
as ADR 0006: the server's own re-validation of the parsed object (unknown
ids, quantities, sections) is untouched by any of this and remains the real
correctness boundary, not this parsing step.

### Configuration: `baseUrl` replaces the implicit Anthropic endpoint, `effort` is dropped

`runtimeConfig.assistant` becomes `{ provider: '', baseUrl:
'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }`
(`NUXT_ASSISTANT_PROVIDER` / `NUXT_ASSISTANT_BASE_URL` /
`NUXT_ASSISTANT_API_KEY` / `NUXT_ASSISTANT_MODEL`). `apiKey` falls back to
`OPENAI_API_KEY` (the ecosystem-standard env var name most OpenAI-compatible
clients already check) the way it fell back to `ANTHROPIC_API_KEY` before.
`effort` (Anthropic's `output_config.effort`, an Anthropic-specific knob) has
no equivalent in the Chat Completions API and is dropped rather than mapped
to something approximate.

Provider auto-detection (`provider: ''`) now resolves to `'openai'` when
either an API key is present (config or `OPENAI_API_KEY`) **or**
`NUXT_ASSISTANT_BASE_URL` was changed away from the default — the latter so
a keyless local server (no key ever configured, by design) still enables
the feature just by pointing `baseUrl` at it. `DeckAssistantStatus.provider`
changes from `'anthropic' | 'fake' | null` to `'openai' | 'fake' | null`,
and gains an optional `baseUrl` (host only, e.g. `api.openai.com` or
`openrouter.ai` — never the key) so the UI can eventually say which
endpoint answered, without ever being able to leak a credential through
that field.

### Tests: inject a fake `fetch`, not a fake SDK client

`tests/nuxt/deck-assistant.test.ts`'s Anthropic-client mocks
(`{ beta: { messages: { stream: () => ({ finalMessage }) } } }`) are
replaced with a fake `fetch` passed to `createOpenAiCompatibleModel({ ...,
fetch })`, the same dependency-injection shape ADR 0006 already used for the
model itself. This covers the fallback chain, fenced/array content, every
mapped status code, timeout/network failure, the no-`Authorization`-header
case, and provider auto-resolution — no behavioral test of the surrounding
assistant logic (pool building, post-processing, validation) changes.

## Consequences

- The assistant now works against a materially cheaper or fully local
  backend, which was the whole point — at the cost of losing Anthropic's
  server-side model fallback on refusal (ADR 0006's `betas:
  ['server-side-fallback-2026-07-01']`); a refusal-equivalent
  (`finish_reason: 'content_filter'`) is now always a hard `502` with no
  automatic retry on another model. Revisiting this (e.g. a configurable
  list of fallback `baseUrl`/`model` pairs the caller retries through) is
  future work if it turns out to matter in practice.
- Structured-output guarantees are now best-effort instead of guaranteed:
  `json_schema` support varies by server, and the `json_object`/no-format
  fallbacks rely on the system prompt's instruction rather than the API
  constraining generation. The server's existing re-validation (ADR 0006's
  "constrain, then verify") is what actually protects correctness here, and
  did not need to change.
- One dependency fewer (`@anthropic-ai/sdk` removed, nothing added) — the
  assistant is now implemented entirely on APIs already available in the
  Node 22 runtime this project requires.
- Anthropic models remain reachable, since most OpenAI-compatible gateways
  (OpenRouter, for one) proxy Anthropic models through the same Chat
  Completions shape; a direct Anthropic-native integration is no longer
  possible without reintroducing something like ADR 0006's original client.
