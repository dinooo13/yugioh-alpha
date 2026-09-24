# Architecture Decision Records

Records of structural decisions (data schema, persistence, auth, core
dependencies, cross-cutting patterns). See
[`docs/WORKFLOW.md` §7](../WORKFLOW.md#7-when-to-write-an-adr) for when to
add one. Don't rewrite an accepted ADR to reverse it — add a new one and
mark the old as superseded.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-card-catalog-data-model.md) | Card catalog data model and YGOPRODeck import | Accepted |
| [0002](0002-owned-card-inventory-data-model.md) | Owned-card inventory data model | Accepted |
| [0003](0003-client-side-ocr-and-speech-entry.md) | Client-side OCR and speech entry, server-side matching | Accepted |
| [0004](0004-deck-data-model.md) | Deck data model | Accepted |
| [0005](0005-rule-format-model.md) | Rule format model | Accepted |
| [0006](0006-ai-deck-assistant.md) | AI deck assistant | Superseded by [0011](0011-deck-assistance-in-chat.md) |
| [0007](0007-sharing-and-profile-model.md) | Sharing and profile model | Accepted |
| [0008](0008-tournament-model.md) | Tournament model | Accepted |
| [0009](0009-openai-compatible-assistant-provider.md) | OpenAI-compatible assistant provider | Accepted (structured-output parts superseded by [0011](0011-deck-assistance-in-chat.md)) |
| [0010](0010-chat-assistant-with-tools.md) | Chat assistant with tools | Accepted (partly superseded by [0011](0011-deck-assistance-in-chat.md)) |
| [0011](0011-deck-assistance-in-chat.md) | Deck assistance in the chat assistant | Accepted |
| [0012](0012-deck-cover-card.md) | Deck cover card chosen by the user | Accepted |
| [0013](0013-english-url-scheme.md) | English URL scheme and permanent redirects from German paths | Accepted |
| [0014](0014-ui-internationalisation.md) | UI internationalisation (German and English) | Accepted |
| [0015](0015-german-card-data.md) | German card data and card display language | Accepted (implemented: F3a–F3c) |
