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

## Key Product Principle

Keep the main concepts separate from the start:

- a catalog card is a global reference card
- an owned card is a user's copy of a catalog card
- a collection is a way to organize owned cards
- a deck is a saved construction using owned cards
- a rule format defines what is legal for a deck

This separation should make later features easier to add without reshaping the product model.
