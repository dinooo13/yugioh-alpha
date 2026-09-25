# 0022: Classic Plus as a built-in format with its own banlist

## Status

Accepted.

## Context

Classic Plus is a house format with its own rulebook (German, "Testfassung").
Its deck rules are simple: Main Deck 40–50, Extra Deck up to 10, no Side
Deck, 3 copies unless a rule says otherwise. Its card rules are not. Rule 1
(Synchro, Xyz, Pendulum and Link monsters) is a card-type check, and rule 2
(cards whose text mentions them) a text check, but rules 3–11 describe what a
card *does*: floodgates, hand traps, draw, effect damage, bypassing a card's
cost, mass removal, protection, negation, denying phases. Deciding those
means reading each card's text. The rulebook also calls its numbers
adjustable ("Stellschrauben").

The rule engine ([ADR 0005](0005-rule-format-model.md)) filters on card data
(type, frame type, attribute, stats, dates, sets, card ids), not on card text
or on what an effect does. The owner decided to keep its filters that way.

## Decision

### A built-in format with its own banlist

`classic-plus` is seeded like the other built-ins, with six rules: the deck
sizes (Main 40–50, Extra up to 10, Side 0), `copies: 3`, a `types` filter
for rule 1 (Synchro, XYZ, Link and Pendulum card types, 0 copies), and
`{ kind: 'banlist', source: 'classic-plus' }` for everything else.

`classic-plus` is a banlist source next to `tcg`, `ocg` and `goat`. Its
statuses don't come from YGOPRODeck: `server/utils/classic-plus-banlist.json`
lists the Forbidden, Limited and Semi-Limited card ids, and
`loadCardDataForValidation` adds a card's status to its `banlistInfo` as
`ban_classic_plus`. The engine reads every banlist the same way, and the list
stays on the server (the browser never runs the engine). The UI names it
"Banlist (Classic Plus)", not "Official banlist".

Why a banlist rather than one filter rule per rule step with a `cardIds` list:
the format stays small enough for `validateRuleSet`, so it can be cloned and
edited like any format; the format editor already handles banlist rules; and
the rule summary doesn't list thousands of card names. The price: a card's
copy-limit reason says "Classic Plus banlist: Limited", not which rule
restricted it. The reasons are in `review.csv` and `classifications.jsonl`.

Rule 1 filters on card types rather than frame types because the format
editor keeps `types` but drops `frameTypes`, so an edited clone would lose
the filter. Pendulum cards whose type doesn't say "Pendulum" (four "Spirit
Monster"s) are forbidden on the banlist instead.

Precedence: a card's banlist status is the strictest limit among the rule
steps it hits. This is the owner's reading of the rulebook ("the stricter
rule wins"), not its literal "first matching rule applies". An exception
inside one rule (rule 4's Battle Phase hand traps) only lifts that rule. The
steps and their limits live in `shared/classic-plus.ts`.

### The banlist is generated, then reviewed

1. `scripts/classic-plus/prefilter.ts` reads the catalog, applies rule 1
   (frame type) and rule 2 (a case-sensitive whole-word match for Synchro,
   Xyz, Pendulum or Link in the English card text), and routes the remaining
   cards with broad keyword patterns. Cards no pattern matches keep 3 copies
   without being classified. Normal Monsters are skipped.
2. The classifier subagent (`.claude/agents/classic-plus-classifier.md`,
   the rulebook verbatim) reads batches of candidates and records, per card,
   every rule step it hits with a verbatim quote from the card text, whether
   one copy can activate that effect more than once per turn, a reason, and
   an "unsure" flag. It does not decide limits. Before every batch it reads
   `scripts/classic-plus/rulings.md`: the owner's decisions on questions the
   rulebook leaves open, collected from the unsure flags rather than by
   reviewing cards one by one. When rulings change, `prefilter.ts
   --reclassify` batches the affected cards again.
3. `scripts/classic-plus/combine.ts` checks the results (known steps, quotes
   that really occur in the text), applies the frequency modifier and the
   stacking rule, drops rule 8 for Extra Deck monsters, applies
   `overrides.json` (manual corrections after review), and writes the
   banlist plus `review.csv`.

`classifications.jsonl` stores each result with a hash of the card text. A
rerun only classifies new cards and cards whose text changed; changing a
step's copy limit needs no classification at all.

## Consequences

- The banlist is as good as the classification and its review. `review.csv`
  lists every restricted or flagged card with its rule steps and reasons.
- New cards from a catalog refresh are unrestricted in Classic Plus until the
  scripts run again, except for rule 1's card types.
- A clone of Classic Plus keeps following the generated banlist; its copy
  limits can be tightened with the format's own rules, not loosened.
- The board rules (no Extra Monster Zones or Pendulum Zones, one shared Field
  Zone, no draw for the first player) aren't deck rules; they're only in the
  description.
