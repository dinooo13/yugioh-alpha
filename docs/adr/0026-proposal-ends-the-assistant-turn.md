# 0026: A proposal ends the assistant turn

## Status

Accepted (#148). Extends the turn loop of
[ADR 0020](0020-assistant-on-the-ai-sdk.md).

## Context

A write tool (`add_to_inventory`, `create_deck`, `update_deck_cards`,
`set_deck_format`) doesn't change anything: it creates a pending proposal,
which the thread shows as an action card with "Übernehmen" / "Ablehnen"
right after the tool chip. The tool loop then went on: the model read
"Proposal created, waiting for the user's confirmation." and wrote another
text step. Live models used it to repeat the proposal's contents, to ask
for the confirmation the card already asks for, or for long comments. The
owner's feedback: the card should end the answer, not sit in the middle of
it with a wall of text below.

## Decision

1. **Prompt rule.** The system prompt asks the model to explain first, in
   the same message as the write call, and to write nothing more after it
   (at most one short sentence); several proposals for one request go
   together in one step.
2. **A stop condition, not just the prompt.** `proposalEndsTurn()` in
   `server/utils/assistant-turn.ts` joins `stopWhen` next to the step cap
   and the #54 repeated-failure guard. It fires after a step that created at
   least one pending proposal, which is a write call whose output carries
   `actionId` (the tool set adds it only when it stored the proposal). The
   SDK's `hasToolCall(...)` is not enough: it fires on any call of the named
   tools, also one whose `execute` threw (e.g. "Card #x does not fit in
   section extra"), and such a failed call must stay correctable by the
   model in the next step.
3. **Several proposals in one step.** The SDK runs every call of a step
   before it checks `stopWhen`, so all of them are stored and streamed, each
   `data-action` right after its own tool result. Then the turn stops.
4. **One exemption per turn.** When the turn's first proposal step made only
   `set_deck_format` proposals whose preview isn't legal, the loop goes on
   once, so the model can add the `update_deck_cards` that makes the deck
   legal (the flow the prompt describes). The next proposal step always
   stops; the step cap bounds everything.
5. **A proper answer.** `fallbackText` treats a turn that ended on a
   proposal as answered: no "too many steps" text, even when the model wrote
   no text at all. A length cut-off is still marked first.
6. **The fake model** (`NUXT_ASSISTANT_PROVIDER=fake`) answers an add
   request with its text before the `add_to_inventory` call in the same step
   ("Hier ist mein Vorschlag."), the order the prompt asks for.
7. **One deck, several proposals: one package.** When a turn proposes
   `update_deck_cards` and `set_deck_format` for the same deck (the "make
   this deck legal" flow, in one step or through the exemption), each
   proposal's preview shows the deck with all of this turn's still pending
   proposals for it applied: every card change on top of the deck's cards,
   checked against the last proposed format. The tool set keeps the turn's
   deck proposals in call order; a later one recomputes the preview, stores
   it on every earlier pending proposal of that deck, and the turn streams
   their views again (a `data-action` part with the same id replaces the
   earlier one in the thread and in the stored answer). So the format card
   no longer says "not legal" next to the card changes that fix it, in
   whichever order the model made the calls. Previewing each proposal on
   its own was the alternative; it is what a user who applies only one of
   them gets, but it contradicts the package the model proposed.
   Such a preview is marked (`preview.combined`), and the action card says
   so ("Vorschau mit den anderen Vorschlägen dieser Antwort").
8. **A package follows what the user does.** When the user applies or
   rejects one proposal of a package (or applying it fails), the apply and
   reject endpoints recompute the previews of the package's remaining
   pending proposals (`refreshPackagePreviews`: the same answer's pending
   deck proposals for the same deck) on the deck as it is now: together
   while more than one is left, in the order they were made, else the last
   one alone (no longer marked). They are stored and returned as `related`
   views, which the thread shows at once; a reload reads them from the
   database anyway.

## Consequences

- No model text after an action card: the card is the answer's last
  element. The `finish` chunk's reason is `tool-calls`; the client doesn't
  read it.
- An answer may consist of tool chips and a card only, when the model put
  its explanation into its reasoning. The card carries the summary.
- A model that makes two proposals in two steps (other than the exempted
  format flow) gets only the first; the prompt asks for them in one step,
  and the user can ask for the rest.
- One model call fewer per proposal turn.
- A package's previews always match what is still pending; the model read
  the first proposal's own preview in its tool result, and that result is
  not rewritten.
- The next turn's history ends the answer with the tool call and its result,
  followed by the user's message, which OpenAI-compatible APIs accept. The
  #116 status rewrite of a resolved proposal works unchanged.
