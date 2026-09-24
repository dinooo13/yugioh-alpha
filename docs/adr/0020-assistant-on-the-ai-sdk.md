# 0020: The chat assistant on the Vercel AI SDK

## Status

Accepted (#84). Implemented in three PRs: 84a (server engine, this record),
84b (client on `@ai-sdk/vue` and the Nuxt UI chat components), 84c (removal
of the former engine). Supersedes the engine parts of
[0009](0009-openai-compatible-assistant-provider.md) and
[0010](0010-chat-assistant-with-tools.md); the mechanism note in
[0011](0011-deck-assistance-in-chat.md) applies.

Implemented (84a–84c). 84c removed the former engine and its SSE endpoint
`POST /api/assistant/chat/:id/messages`, so the side-by-side note under
Consequences no longer holds. The legacy converter stays.

## Context

The chat assistant (ADR 0010) ran on a hand-written engine: a `fetch` + SSE
client for the Chat Completions API (tool-call deltas accumulated by index,
finish reasons mapped by hand, timeouts combined with the cancel signal), a
round loop (`runChatTurn`), our own SSE event protocol to the client, and a
message format of one row per model round plus one `tool` row per result.
Every provider quirk and every UI state (tool chips, proposals, cancel) was
our code.

The owner asked to use as much of an SDK as possible. At the same time the
configured model (MiMo V2.6 Pro on OpenCode Go) showed looping tool calls
(#54): empty arguments, the same failing call again and again, and tool
calls written into the answer text instead of made. Nuxt UI 4.9, already in
the app, ships chat components built for the AI SDK's `UIMessage`.

## Decision

1. **AI SDK 7.** `ai` (`streamText`, `createUIMessageStream`,
   `convertToModelMessages`, `pruneMessages`), `@ai-sdk/openai-compatible`
   for any Chat Completions endpoint, and in 84b `@ai-sdk/vue` with the Nuxt
   UI chat components. Nuxt UI stays on 4.9 (built against ai 6): its chat
   components' types were checked against ai 7 with a scratch page before any
   code was written. The upgrade to Nuxt UI 4.10+ comes with #86.
2. **`UIMessage` parts are the stored format.** One `assistant_message` row
   per UIMessage; its parts in a new `parts` JSON column, optional metadata in
   `metadata` (migration 0016, `ALTER TABLE ADD` only), the joined text still
   in `content`. The assistant row is inserted before the model runs (the id
   the client sees, and the FK target of a proposal), updated after every
   step and at the end, and deleted again when the turn produced nothing.
   **Rows of the former engine are converted when read and never
   rewritten** (`legacyRowsToUIMessages`): a round's `tool` rows become tool
   parts of one assistant message, a missing result an `output-error`.
3. **Proposals stay database rows.** A write tool still creates a pending
   `assistant_action`; it reaches the client as a typed `data-action` part
   (refreshed to the action's current state when read). The SDK's tool
   approval was evaluated and not adopted: a request is raised before the
   tool runs, but our proposal is the validated result of running it
   (preview, legality, missing cards); only the latest message can be
   approved, which blocks follow-up questions; and every approval costs
   another model call, where "Übernehmen" is an instant REST call today.
4. **Flat, hand-written JSON schemas.** Tools are `tool()`s with
   `jsonSchema(<the existing schema>, { validate })`, built per turn. No zod:
   its `.nullable()`/`.optional()` conversion brings back
   `['string', 'null']` unions, which the configured model garbles into
   empty arguments. The model reads only the tool `result`
   (`toModelOutput`); the part's display-only `deckName` (#53) stays out.
5. **Guards against looping tool calls (#54).** Empty or non-object
   arguments fail the SDK's input validation with a specific text; after two
   identical failures (same tool, same input) `prepareStep` switches tools
   off (`toolChoice: 'none'`), after three a stop condition ends the turn
   with a note; a tool call written as text gets one corrective
   continuation with a hint in the instructions, never a second. The SDK
   hands a failed call to the model as its rendered error object;
   `prepareStep` replaces that with our plain error text, the same text the
   stored part carries. A prompt rule asks for the tool-calling interface.
6. **The fake provider** (`NUXT_ASSISTANT_PROVIDER=fake`) is a
   `MockLanguageModelV4` from `ai/test` with the former script ported to the
   SDK's prompt format, plus two test triggers for the #54 guards.
7. **Error codes stay ours (ADR 0014).** Before the stream opens, errors are
   HTTP errors with `data.code` as before (404, 503, 409, 413, 400, plus the
   new 409 `regenerate_not_allowed`). During the turn, the stream's `error`
   chunk carries the code: provider 401/403 → `assistant_misconfigured`,
   429 → `assistant_busy`, other provider and network errors and a model
   call's timeout → `assistant_unreachable`, anything else `unexpected`. A
   failed tool call's part carries its English error text.
8. **Only the newest message is sent.** `POST /api/assistant/chat/:id/stream`
   takes what the SDK's chat transport sends (`trigger`, the new user
   message with text and image `file` parts, validated with the former
   limits); the history comes from the database and is trimmed by the
   existing count/size limits. Photos go to the model in their own turn only;
   stored is a `data-image` placeholder, never the bytes (ADR 0010).
   "Regenerate" replaces the last answer while all its proposals are still
   pending, and retries a failed turn.
9. **Reasoning is shown.** MiMo's `reasoning_content` becomes reasoning parts,
   streamed and stored for display (collapsed in 84b), and never sent back to
   the model (`pruneMessages`).

Kept as they were: the tools and their validation, the pending-action
apply/reject flow, the system prompt with the per-turn deck context (ADR
0011) and language instructions, the fallback texts saved into an answer
(cut off, no answer, too many steps, cancelled, timeout), the per-user turn
lock, the request size limits and the configuration (ADR 0009).

## Consequences

- New dependencies: `ai` and `@ai-sdk/openai-compatible` (84a),
  `@ai-sdk/vue` (84b). The SDK requires Node 22 or newer (CI and the
  Dockerfile use 22).
- The legacy converter is permanent code, tested against the demo
  database's shapes.
- The history's size budget now counts the JSON of tool inputs and results,
  so the same limits keep a little less history than before.
- Tool results are sent to the client in the tool parts, as the former
  engine sent them with the conversation.
- The SDK appends its own identifier to the `User-Agent`
  (`ygo-alpha/<version> ai-sdk/openai-compatible/…`).
- Until 84c, both engines run side by side: the current UI still uses
  `POST /api/assistant/chat/:id/messages`, which reads rows of the new
  format as plain text.
