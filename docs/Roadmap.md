# Yu-Gi-Oh Card App Roadmap

## Product Vision

Build a personal Yu-Gi-Oh card app that helps players catalog their cards, organize collections, build decks from cards they actually own, validate decks against flexible rule formats, and later share collections or run tournaments.

The product should start as a reliable personal inventory and deckbuilding tool. More advanced features such as AI deck assistance, social sharing, and tournament tracking should build on that foundation rather than shape the first release.

## Core Product Concepts

### Card Catalog

The card catalog is the global reference for all known Yu-Gi-Oh cards. It can be powered by an external data source such as the YGOPRODeck/Yu-Gi-Pro API.

The catalog should represent card-level information such as:

- card name
- card type
- attributes and properties
- effects and text
- sets and printings
- release information
- artwork and images

Catalog cards are not owned cards. They are the canonical source that user-owned cards refer to.

### User Inventory

The inventory represents the cards a user actually owns. A user-owned card should reference a catalog card, but it may also carry ownership-specific information.

Examples include:

- quantity
- language
- condition
- edition or printing
- storage location
- collection or box assignment

The user should be able to search across their complete inventory, regardless of how the cards are split across collections or boxes.

### Collections and Storage

Users should be able to organize cards into one or more collections or storage locations.

Examples:

- all owned cards
- Box 1
- Box 2
- binder
- trade pile

This structure should support both broad inventory management and practical physical storage.

### Decks

Users should be able to create and save multiple decks from their own inventory.

Decks should support:

- main deck
- extra deck
- side deck
- card counts
- validation against available inventory
- validation against selected rule formats

The app should clearly distinguish between cards a user owns, cards used in a deck, and cards that exist only in the global catalog.

### Rule Formats

Rule formats define which cards and quantities are legal for a deck.

Formats should be flexible enough to model official-style restrictions and custom house rules. A rule can be based on any relevant card data that exists in the card model.

Example rule ideas:

- only cards released before 2006 are allowed
- specific cards are forbidden
- cards with effects are limited to one copy
- cards with effects are limited to two copies
- cards of a certain attribute are allowed or disallowed
- cards from certain sets are allowed or disallowed

The rule format system should eventually support both reusable global formats and user-defined custom formats.

### AI Deck Assistance

AI should help users build decks from their own cards and within a selected rule format.

Useful capabilities include:

- suggest a deck from the user's inventory
- explain why cards were selected
- optimize for a selected play style
- identify missing cards separately from owned cards
- improve an existing deck
- adapt a deck to a different rule format

The AI should be constrained by inventory and rules, not just generate an idealized deck list.

### Sharing and Social Features

Later, users should be able to selectively share collections and decks with other users.

Possible sharing modes:

- private
- shared with selected users
- shared by link
- public

The first social goal should be visibility and comparison. Trading, wishlists, or marketplace-like behavior can be considered later.

### Tournament Mode

Tournament tracking is a later-stage feature that depends on users, decks, and rule formats being stable.

Possible capabilities:

- create a tournament
- select a rule format
- manage participants
- register decks
- track pairings
- record match results
- display standings
- keep tournament history

## Roadmap

### Phase 1: Personal Inventory MVP

Goal: Let a user reliably catalog and find the cards they own.

Scope:

- user accounts and login
- global card catalog
- card search and filtering
- manual inventory entry
- owned card quantities
- collections or storage locations
- search across the user's full inventory

Product outcome:

Users can answer: "Which cards do I own, how many do I have, and where are they?"

### Phase 2: Faster Card Entry

Goal: Make it faster and easier to add many cards to the inventory.

Scope:

- photo-based card recognition
- OCR-assisted entry
- voice input
- bulk entry workflows
- suggested matches
- review and correction flow before cards are saved

Product outcome:

Users can add cards quickly without relying only on manual search and entry.

Note: "photo-based card recognition" is now covered by the chat assistant's
image input (a photo attached to a chat message, identified by the model and
confirmed via its `search_catalog` tool — see
[Phase 8](#phase-8-chat-assistent-mit-werkzeugen) and
[ADR 0010](adr/0010-chat-assistant-with-tools.md), which superseded the
original client-side-OCR approach of
[ADR 0003](adr/0003-client-side-ocr-and-speech-entry.md)). Recognizing a card
from its artwork alone via perceptual hashing or embeddings against catalog
images, without a model in the loop, is still open and depends on the locally
cached card images that [ADR 0001](adr/0001-card-catalog-data-model.md) lists
as follow-up work.

Voice input is currently not offered: Web Speech dictation in the chat
composer was removed because it didn't work reliably; it's open again.

### Phase 3: Deckbuilder

Goal: Let users build and save decks from their own cards.

Scope:

- create, edit, and delete decks
- add cards from owned inventory
- main deck, extra deck, and side deck areas
- card count tracking
- availability checks against owned quantities
- deck search and filtering

Product outcome:

Users can build decks that reflect their real collection, not just the full card catalog.

### Phase 4: Rule Formats and Deck Validation

Goal: Support flexible deck legality checks for official and custom formats.

Scope:

- rule format model
- card legality rules
- quantity limits
- forbidden, limited, and semi-limited cards
- release-date-based rules
- card-property-based rules
- live validation inside the deckbuilder
- saved custom formats

Product outcome:

Users can build decks for specific rule environments and immediately see whether a deck is legal.

Implemented: built-in formats (TCG Advanced, OCG, GOAT, Ohne Banliste) plus custom formats under
`/formats`, with live validation in the deckbuilder. See
[`docs/adr/0005-rule-format-model.md`](adr/0005-rule-format-model.md).

### Phase 5: AI Deck Assistance

Goal: Help users create and improve decks using their inventory and selected rule formats.

Scope:

- generate deck suggestions from owned cards
- improve an existing deck
- explain card choices
- support play style preferences
- respect selected rule formats
- separate owned-card suggestions from missing-card suggestions

Product outcome:

Users can get meaningful deckbuilding help that understands their collection and constraints.

Implemented: deck assistance lives in the chat assistant at `/assistant` (see
[Phase 8](#phase-8-chat-assistent-mit-werkzeugen)). "Mit KI erstellen" on `/decks` opens a
conversation with a new-deck draft; "Mit KI bearbeiten" in the deck editor opens a conversation
linked to that deck, whose current contents, format, and legality the assistant sees on every
turn. The assistant prefers the user's inventory (`search_inventory` reports each owned card's
copy limit in a format and leaves out forbidden cards), checks proposals with `validate_deck`,
and every proposed deck or deck change shows the rule engine's legality verdict and the cards
the user doesn't own (enough of) — separately from the deck itself — before it is confirmed.
Talks to any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Ollama, LM Studio,
OpenCode Zen, ...); without a configured provider, the UI shows an "Assistent nicht verfügbar"
notice. See [`docs/adr/0011-deck-assistance-in-chat.md`](adr/0011-deck-assistance-in-chat.md)
(which replaced the original one-shot builder at `/decks/assistent` and the deck editor's
"KI-Vorschläge" panel from [ADR 0006](adr/0006-ai-deck-assistant.md)) and
[`docs/adr/0009-openai-compatible-assistant-provider.md`](adr/0009-openai-compatible-assistant-provider.md).

### Phase 6: Sharing and Social Features

Goal: Let users selectively share collections and decks.

Scope:

- user profiles
- collection sharing permissions
- deck sharing permissions
- shared links or selected-user access
- viewing another user's shared cards or decks
- optional trade or wishlist concepts

Product outcome:

Users can compare collections and decks with other players when they choose to share them.

Implemented: public profiles at `/players/<handle>` with an editable profile under `/profile`,
plus per-resource sharing (privat, nur über Link, öffentlich, oder für einzelne Spieler
freigegeben) for decks, single collections, and the whole inventory — shared views are read-only
and never disclose the owner's availability data. Includes a wishlist under `/wishlist` that
can be published on the profile. Trading is explicitly out of scope. See
[`docs/adr/0007-sharing-and-profile-model.md`](adr/0007-sharing-and-profile-model.md).

### Phase 7: Tournament Mode

Goal: Track tournaments and match results inside the app.

Scope:

- tournament creation
- participant management
- rule format selection
- deck registration
- round and pairing tracking
- match result entry
- standings
- tournament history

Product outcome:

Groups can run and track Yu-Gi-Oh tournaments using decks and formats already modeled in the app.

Implemented: tournaments under `/tournaments` with Swiss or round-robin pairings, participants
added as app users (by e-mail) or as guests, deck registration that snapshots the decklist and
its legality in the selected rule format, round-by-round pairings with match result entry,
live standings with OMW%/GW%/OGW% tiebreakers, and a history of finished tournaments. See
[`docs/adr/0008-tournament-model.md`](adr/0008-tournament-model.md).

### Phase 8: Chat-Assistent mit Werkzeugen

Goal: Replace the deck assistant's single-purpose entry points and the
inventory's photo/voice modes with one conversational assistant that can act
on the user's whole collection.

Scope:

- a persisted, multi-turn chat with the assistant
- a tool layer over the catalog, inventory, decks, and formats (search,
  read, and validate — no direct writes)
- write requests (add cards to the inventory, create a deck, change a
  deck's cards or its format) proposed as pending actions the user must
  confirm
- image input (a card photo) identified by the model and confirmed against
  the catalog
- ~~voice dictation into the chat composer~~ (removed, see below)
- conversation list with rename-by-first-message titles and deletion

Product outcome:

Users can ask the assistant about their collection in one place — "which
Blue-Eyes cards do I own", "build me a GOAT deck from what I have", "what's
on this photo" — and have it propose changes they explicitly confirm, instead
of switching between a deck-only builder and a text/photo/voice entry form.

Implemented: a new page at `/assistant` with a persisted conversation per
thread, a tool layer (`search_catalog`, `get_card`, `search_inventory`,
`list_collections`, `list_decks`, `get_deck`, `list_formats`,
`validate_deck`, plus the write tools `add_to_inventory`, `create_deck`,
`update_deck_cards`, and `set_deck_format`) that only ever produces a
pending action for a write,
shown as an action card the user applies or rejects. Image attachments live
in the chat composer, replacing the Foto mode `/inventory/quick-entry` used to
have (its Sprache mode was replaced by Web Speech dictation in the composer,
since removed because it didn't work reliably); the Liste mode there is
unchanged. Works with any OpenAI-compatible Chat Completions endpoint that
supports streaming and tool calls, with an optional
`NUXT_ASSISTANT_VISION_MODEL` override for image-containing turns. See
[`docs/adr/0010-chat-assistant-with-tools.md`](adr/0010-chat-assistant-with-tools.md).
Since [ADR 0011](adr/0011-deck-assistance-in-chat.md) the chat is also the only deck
assistant: the one-shot `/decks/assistent` builder and the deck editor's "KI-Vorschläge"
panel are gone, replaced by entry points into `/assistant` — a conversation can be linked to
a deck ("Mit KI bearbeiten"), and deck proposals carry a legality/missing-cards preview.
The recommended OpenCode Go model is `mimo-v2.6-pro` (MiMo V2.6 Pro), which
covers text, streamed tool calls, and image turns without a separate vision
model; see [`.env.example`](../.env.example).

### Phase 9: German and English (#34)

Goal: Make the app usable in English as well as German, including card names.

Scope, as three stacked parts:

- F1: English, language-neutral route slugs, with permanent redirects from
  every old German URL (bookmarks and handed-out share links keep working)
- F2: an i18n layer, a UI language switch, and extraction of the UI strings
- F3: a card display language and bilingual card search

Product outcome:

Users pick the language of the interface and of card names, and a shared link
works the same for every reader regardless of their language.

Status: F1 is implemented — every page moved to an English path (`/inventory`,
`/catalog`, `/players/<handle>`, …) and old German URLs answer with a single
`301` to their new one. See
[`docs/adr/0013-english-url-scheme.md`](adr/0013-english-url-scheme.md).

F2 is in progress, as four stacked PRs (F2a merged):

- F2a — foundation: `@nuxtjs/i18n` with per-namespace de/en catalogues, the
  locale resolution (profile → `ui_locale` cookie → Accept-Language → German)
  rendered on the server, `user_profile.locale`, the "Anzeigesprache /
  Interface language" switch (profile settings, login and public pages), and
  the app shell, auth, profile and dashboard strings
- F2b — the collection side (inventory, quick entry, catalog, collections,
  wishlist, sharing, player pages)
- F2c — decks, formats and tournaments, with validation messages as code +
  parameters
- F2d — the assistant, the final lint and copy gates, and Accept-Language
  detection switched on (until then an English browser still gets German)

See [`docs/adr/0014-ui-internationalisation.md`](adr/0014-ui-internationalisation.md).
F3 is open.

## Recommended Build Order

1. Card catalog and personal inventory
2. Collections, boxes, and inventory search
3. User accounts and ownership boundaries
4. Deckbuilder based on owned cards
5. Rule formats and deck validation
6. Photo and voice entry
7. AI deck assistance
8. Sharing and social features
9. Tournament mode
10. Chat assistant with tools
11. German and English

## Key Product Principle

Keep the main concepts separate from the start:

- a catalog card is a global reference card
- an owned card is a user's copy of a catalog card
- a collection is a way to organize owned cards
- a deck is a saved construction using owned cards
- a rule format defines what is legal for a deck

This separation should make later features easier to add without reshaping the product model.
