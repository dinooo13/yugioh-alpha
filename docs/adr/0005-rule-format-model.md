# 0005: Rule format model

## Status

Accepted

## Context

Phase 4 of the [Roadmap](../Roadmap.md) adds rule formats and deck validation:
deck size and copy limits, forbidden/limited/semi-limited cards, official
banlists, release-date rules, card-property rules, live validation in the
deckbuilder, and user-defined custom formats.

The roadmap's "Rule Formats" concept is explicit that a rule "can be based on
any relevant card data that exists in the card model" and lists examples as
different as "only cards released before 2006", "specific cards are forbidden",
"cards with effects are limited to one copy", and "cards from certain sets are
allowed or disallowed". It also asks for both *reusable global* formats and
*user-defined custom* formats.

Two existing models constrain the design: the catalog
([ADR 0001](0001-card-catalog-data-model.md)) already stores `banlist_info`,
`tcg_date`/`ocg_date`, type/frame type/attribute/race/archetype, stats, and
printings per set; decks ([ADR 0004](0004-deck-data-model.md)) reference
catalog cards, derive availability at read time, and deliberately carry "no
format, banlist, or legality columns", leaving a nullable `format_id` to this
phase.

## Decision

### Rules are a JSON list of typed predicates, evaluated in code

`rule_format.rules` holds a `RuleSet` — a JSON array of discriminated-union
rules (`deck_size`, `copies`, `card_status`, `banlist`, `filter`) — and the
evaluation lives in `shared/rule-formats.ts` as a pure function
`evaluateDeck(rules, deckCards, cardData)`.

The relational alternative (a `rule` table plus `rule_condition`/`rule_value`
child tables, or a table per rule kind) was rejected:

- A rule is never queried *across* formats. The only access pattern is "load
  this one format and apply it to this one deck", so normalizing rules buys no
  query power, only joins.
- The predicate space is wide and open-ended (types, attributes, races,
  archetypes, sets, stat ranges, dates per region, name substrings, ...) and
  will keep growing with the card model. In a relational model every new
  predicate is a migration; here it is a new optional field on `CardFilter`
  plus its evaluation branch.
- Evaluating a mixed AND/OR predicate tree in SQL against 60 deck cards is
  strictly harder than evaluating it in TypeScript over the handful of cards a
  deck actually contains.
- Writes stay atomic: saving a format is one row update, not a delete-and-
  reinsert of a rule tree.

The price is that the database cannot enforce the shape of a rule. That is paid
for with a strict, exhaustive validator (`validateRuleSet`) that every write
passes through: unknown rule kinds, bad dates, inverted ranges, out-of-bounds
copy counts, and oversized lists are rejected with a 400, ids are deduped and
bounded, and unknown keys are dropped. Card ids referenced by a `card_status`
rule are additionally checked against the catalog on the server. A stored blob
is therefore always a valid `RuleSet`.

Because the engine is pure and dependency-free, the deckbuilder, the format
editor, and the server all run *the same* code — a rule can never be described
in the UI differently from how it is enforced.

### Global and user formats live in one table, distinguished by a nullable `user_id`

`rule_format.user_id` is nullable: `NULL` marks a built-in, globally visible
format, a value marks that user's custom format. `is_builtin` makes the
intent explicit (and queryable) instead of relying on the absence of an owner.

A separate `builtin_format` table would duplicate every column and force every
read, the deck's `format_id` FK, and the format picker to union two tables.
Visibility is instead one predicate: `is_builtin = 1 OR user_id = :me`.
Another user's format is reported as *missing* (404), the same ownership
boundary as collections, inventory, and decks; built-ins reject writes with a
403 and a message pointing at "clone", because pretending they do not exist
would be misleading when everybody can see them.

### Built-ins are seeded at boot, not migrated in

`seedBuiltinFormats(db)` upserts `tcg-advanced`, `ocg`, `goat`, and
`unlimited` by fixed slug id from `server/plugins/migrate.ts` after the
migrations run. `name`, `description`, and `rules` are refreshed on every
boot; `created_at` and every `deck.format_id` referencing them survive.

Seeding through a data migration would freeze the rules at the migration's
timestamp and require a new migration (and a manual fix-up of already migrated
databases) for every improvement. Keeping the definitions in code makes the
built-ins reviewable in a diff and shipped by a deploy.

### Validation is computed at read time and never stored

There is no `deck.is_legal` column and no validation cache. `DeckDetail`
carries a `validation` object computed on every read *and* every write
response, and the deck list computes `legal` per deck the same way.

Legality depends on three independently mutable inputs — the deck's cards, the
format's rules, and the catalog (a banlist refresh changes legality without
touching either). A stored flag would be wrong after any of them changes, and
invalidating it correctly means recomputing it anyway. The cost is bounded:
the engine is O(cards × rules) over a deck, plus two indexed queries for the
card data and printings.

The consequence for the list endpoint is that `legal=` cannot be a SQL
predicate: the matching decks are scanned (bounded by
`MAX_LEGALITY_SCAN = 500`), evaluated, and paginated in memory. That is
acceptable for a personal collection app and avoids a denormalized counter
that would have to be maintained on every deck, format, and catalog write.

### The deck reference is a nullable, `SET NULL` foreign key

`deck.format_id` references `rule_format.id` with `ON DELETE SET NULL`.
"No format" is a first-class state: the deck stays fully editable and simply
makes no legality statement (`validation: null`, `legal: null`) — it is not
"legal" and not "illegal". Deleting a format therefore never deletes or breaks
a deck; it only un-assigns it. Only a built-in or one of the caller's own
formats may be assigned, and since that id is part of a deck write it is
rejected with a 400 rather than a 404.

### Interaction with Phase 3's structural warnings

The `DECK_LIMITS` warnings from [ADR 0004](0004-deck-data-model.md) (40–60
main, 15 extra, 15 side, 3 copies) stay as *informational hints* for decks
without a format. Once a format is assigned, its `deck_size`/`copies` rules are
the authority and produce `error`-severity issues. Deck writes are still never
rejected for a rule violation: a work in progress must be saveable.

### Semantics worth writing down

- Copies are counted across main + extra + side; the effective cap per card is
  the **minimum** of the `copies` rule (default 3), any `card_status`, the
  selected banlist, and every applicable `filter` rule.
- `hasEffect` is true for Spell/Trap/Skill cards and for every monster whose
  type does not contain "Normal".
- A card **without** a release date for the selected region never matches
  `releasedBefore`/`releasedAfter`. A GOAT-style "only cards up to June 2005"
  rule (`not_matching releasedBefore → 0`) therefore disallows cards with an
  unknown date — the conservative reading.

## Consequences

- Adding a predicate is a change in one pure module plus its tests; no
  migration, no new table.
- The same rule set can be previewed against a deck before it is saved
  (`POST /api/formats/validate`) and a deck can be previewed against a format
  before it is assigned (`GET /api/decks/:id/validate?formatId=`), because
  nothing about validation is persisted.
- Rule sets are opaque to SQL: "which formats forbid Pot of Greed?" would need
  a scan (or a derived index table) rather than a join. No product requirement
  asks for it.
- Built-in rules can change under an existing deck, and its legality changes
  with them. That is the same behavior as a real banlist update.
- A future tournament mode can reference `rule_format.id` directly; because
  built-ins and custom formats share a table, nothing special is needed for
  "official format" tournaments.
