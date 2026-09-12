# yugioh alpha

Management for Yu-Gi-Oh! collections, decks, formats, and tournaments. Built with [Nuxt 4](https://nuxt.com) and [Nuxt UI](https://ui.nuxt.com).

## Requirements

- Node.js 22 or newer
- pnpm 11 via [Corepack](https://nodejs.org/api/corepack.html) (included with Node 16.13 and newer)

```bash
corepack enable
```

## Setup

```bash
pnpm install
```

Configure environment variables (optional for local development; unsafe defaults allow it to run without this step):

```bash
cp .env.example .env
```

See [`.env.example`](./.env.example) for all available variables:

- `NUXT_BETTER_AUTH_SECRET` - secret for Better Auth (required in production, for example `openssl rand -base64 32`)
- `NUXT_PUBLIC_BETTER_AUTH_URL` - publicly reachable base URL of the app
- `NUXT_DB_FILE_PATH` - path to the SQLite database file (default: `./data/app.db`; the directory is created automatically)
- `NUXT_ASSISTANT_API_KEY` - Anthropic API key for the AI deck assistant (optional; falls back to `ANTHROPIC_API_KEY`). Without a key the feature is disabled and the UI shows a notice instead.
- `NUXT_ASSISTANT_PROVIDER` / `NUXT_ASSISTANT_MODEL` / `NUXT_ASSISTANT_EFFORT` - override the assistant's provider (`anthropic` / `fake`), model id, and output effort; see [`.env.example`](./.env.example)

## Development

Start the dev server at `http://localhost:3000`:

```bash
pnpm dev
```

## Database / Migrations

Drizzle migrations live in `server/db/migrations` and are **applied automatically on server startup** (`server/plugins/migrate.ts`), so no manual step is required for normal development or production operation.

When the schema changes, manually generate or apply a new migration:

```bash
pnpm db:generate   # generate a new migration from server/db/schema.ts
pnpm db:migrate    # apply migrations manually
```

## Card Catalog

The global card catalog (`catalog_card`, `catalog_set`, `catalog_printing`, `catalog_card_image`) is populated from the [YGOPRODeck API](https://ygoprodeck.com/api-guide/) rather than entered by hand. See [`docs/adr/0001-card-catalog-data-model.md`](./docs/adr/0001-card-catalog-data-model.md) for the schema/import design.

After running migrations, populate (or refresh) the catalog with a full sync — this is **not** run automatically on startup, since it fetches the entire card database:

```bash
# Run the Nitro task directly
pnpm nuxt task run catalog:sync
```

or trigger it from a running server as an authenticated user:

```bash
curl -X POST http://localhost:3000/api/admin/catalog/sync \
  -H "Cookie: <your better-auth session cookie>"
```

The sync is idempotent (upsert-based) and safe to re-run at any time to pick up new or updated cards. Card images are currently stored as remote YGOPRODeck URLs; a local image proxy/cache is planned as follow-up work (see the ADR).

### Local Card Images

YGO Omega card assets copied into `public/assets/ygo-omega/de` are Unity bundle
payloads, not browser-ready images. Extract them into stable web assets with:

```bash
python3 -m pip install UnityPy Pillow
pnpm assets:extract:omega
```

The extractor writes images to `public/assets/cards/de` and creates
`public/assets/cards/de/manifest.json`, keyed by card id when the Unity texture
name contains a known id from Omega's copied `db.sqlite`.

## Schnellerfassung

`/inventar/erfassen` adds many cards at once. All three input modes feed the
same review queue, and nothing is written before it has been confirmed:

- **Liste** – one card per line. Quantities (`3x Dark Magician`,
  `Dark Magician x3`, `3 Dark Magician`), set codes (`Dark Magician (SDY-006)`
  or a bare `SDY-006`), and 8-digit passcodes (`46986414`) are recognized
  automatically.
- **Foto** – take or drop a photo of the card. OCR runs **in the browser** via
  [`tesseract.js`](https://github.com/naptha/tesseract.js) (lazily imported,
  English model): the image is never uploaded, only the recognized text is
  sent for matching. The first run downloads the Tesseract WASM core and the
  language data from the package CDN.
- **Sprache** – dictate card names through the browser's Web Speech API
  (German/English, continuous). Browsers without support (e.g. Firefox) show a
  hint instead.

The review table preselects certain matches (passcode, set code, exact name)
and anything scoring at least 0.85, marks weaker hits as "Unsicher" with a
candidate dropdown, and offers an inline catalog search for lines without a
match. Language, condition, edition, and collection come from a
"Standardwerte" panel and can be overridden per row. Saving posts the rows to
`POST /api/inventory/bulk` in batches of 50, each batch in one transaction.

See [`docs/adr/0003-client-side-ocr-and-speech-entry.md`](./docs/adr/0003-client-side-ocr-and-speech-entry.md)
for why OCR and speech run client-side while matching stays on the server.

## Decks

Decks live under `/decks`: the list page searches by deck name *or* by a card
contained in the deck, and the editor at `/decks/<id>` manages the Main, Extra,
and Side Deck of a single deck. Cards are added from the card source panel,
which searches the user's inventory by default and, with "Auch Katalogkarten
anzeigen", the whole catalog — so a deck can be planned with cards that aren't
owned yet. Fusion/Synchro/XYZ/Link monsters can only go into the Extra or Side
Deck; every other card only into the Main or Side Deck.

A deck references **catalog** cards, not owned-card rows (see
[`docs/adr/0004-deck-data-model.md`](./docs/adr/0004-deck-data-model.md)).
Availability is therefore derived on every read:

- `owned` is the sum of `owned_card.quantity` for that catalog card across all
  collections, conditions, languages, and editions.
- `usedInDeck` counts the copies used across *all* sections of that deck, and
  `shortfall = max(0, usedInDeck - owned)` is shown as a red `used/owned`
  indicator; the deck list shows "Vollständig" or "n fehlen".
- Owned copies are **not** reserved across decks: the same physical card may
  appear in any number of saved decks, and each deck reports its own shortfall.

Deck sizes (40–60 main, 15 extra, 15 side) and the 3-copies-per-card rule are
returned as `warnings` rather than enforced. They are only the fallback hints
for a deck without a rule format — once a format is assigned, its rules govern
the limits (see [Formate](#formate)). Only structurally invalid writes (unknown
card, unknown section, negative quantity, more than 99 copies in a single row,
card in a forbidden section) are rejected.

## Formate

Rule formats decide which cards and how many copies a deck may play. They live
under `/formate` and are split into two groups:

- **Offizielle Formate** — built-in, globally available, and read-only:
  `TCG Advanced`, `OCG`, `GOAT Format`, and `Ohne Banliste`. They are upserted
  on every server start (`seedBuiltinFormats`, see `server/plugins/migrate.ts`),
  so improved rules ship with a deploy instead of a data migration. Anybody can
  clone a built-in ("Klonen") to get an editable copy.
- **Meine Formate** — the user's own formats, created in the editor at
  `/formate/neu` and editable, duplicable, and deletable. Deleting a format
  keeps every deck that used it and only resets that deck's format to "none".

A format is a list of typed rules (max 50) stored as JSON and evaluated in code
(`shared/rule-formats.ts`, see
[`docs/adr/0005-rule-format-model.md`](./docs/adr/0005-rule-format-model.md)):

| Rule | Meaning |
|------|---------|
| `deck_size` | min/max cards in the Main, Extra, or Side Deck |
| `copies` | default copies per card (1–10, normally 3) |
| `card_status` | specific cards are forbidden / limited / semi-limited |
| `banlist` | the official TCG, OCG, or GOAT banlist (`catalog_card.banlist_info`) |
| `filter` | restrict all cards matching (or *not* matching) a card filter to 0–3 copies |

A card filter can combine types, frame types, attributes, races, archetypes,
sets, card ids, level/ATK/DEF ranges, a name substring, an effect flag, and a
release cut-off. All provided fields are ANDed, the values inside one field are
ORed, and an empty filter matches every card.

### Validation semantics

- Copies are counted across **main + extra + side**. The effective limit per
  card is the **lowest** of: the `copies` rule (default 3), an explicit
  `card_status`, the selected banlist, and every applicable `filter` rule.
- `hasEffect` is true for Spell, Trap, and Skill cards (they are nothing but
  effect text) and for every monster whose card type does not contain
  "Normal" — so "Normal Monster", "Normal Tuner Monster", and "Pendulum Normal
  Monster" count as *without* effect.
- `releasedBefore`/`releasedAfter` compare **strictly** (the boundary date
  itself does not match) against the TCG date by default, or the OCG date with
  `region: 'ocg'`. A card **without** a date for that region never matches, so
  a GOAT-style "only cards up to June 2005" rule
  (`not_matching releasedBefore 2005-07-01 → 0 copies`) also disallows cards
  with an unknown release date — the conservative choice.
- Legality is **never stored**. It is recomputed on every deck read and on
  every write response, so a card change, a format edit, or a catalog refresh
  takes effect immediately. A deck without a format is neither legal nor
  illegal (`validation: null`).

In the deck editor a format is picked in the header; the "Regelprüfung" panel
then shows `Legal` / `Nicht legal – n Probleme` with the issue list, and every
affected row is badged (`Verboten`, `Limitiert (1)`, `Semi-limitiert (2)`). The
deck list shows the format name plus a legality badge and can filter by format
and legality. The format editor can check any of the user's decks against the
*unsaved* rules before saving them.

## KI-Deck-Assistent

The AI deck assistant lives at `/decks/assistent` (build a new deck from the
inventory) and as a "KI-Vorschläge" panel in the deck editor (improve an
existing deck). Both respect the currently selected rule format and split
their output into owned suggestions and a separate list of missing cards, so
a suggestion never silently assumes cards the user doesn't have.

The server never trusts the model with a free-form deck list: it first
builds a candidate pool of owned cards the selected format actually allows
(capped at 400 cards, with a warning if a collection is larger), the model
may only pick card ids from that pool (or name a missing card by its exact
English name, resolved against the catalog), and every returned field is
re-validated — unknown ids dropped, sections corrected, quantities clamped
to what's owned and legal — before the existing rule engine
(`evaluateDeck`, see [Formate](#formate)) runs on the result. Nothing about
a suggestion is persisted; a build result is saved through `POST /api/decks`
(which can seed a new deck's cards atomically) and improve changes go
through the same `PUT /api/decks/:id/cards` endpoint a manual edit would
use.

The feature requires `NUXT_ASSISTANT_API_KEY` (or the SDK's own
`ANTHROPIC_API_KEY`) to be configured; without it, `/api/assistant/status`
reports the feature as disabled and the UI shows a notice instead of the
assistant panels. See
[`docs/adr/0006-ai-deck-assistant.md`](./docs/adr/0006-ai-deck-assistant.md).

## Quality Checks

```bash
pnpm lint
pnpm typecheck
```

## Tests

Unit/component tests (Vitest, `tests/nuxt/`):

```bash
pnpm test
```

End-to-end tests (Playwright, Chromium, `e2e/`) build the app and start it against a separate test database in `e2e-data/`:

```bash
pnpm test:e2e
```

The Playwright `webServer` boots with `NUXT_E2E_SEED_CATALOG=1`, which makes `server/plugins/migrate.ts`
upsert a small, deterministic set of ~14 real cards (`server/db/fixtures/catalog-fixture.ts`) after
migrations — this never happens outside of E2E runs. Specs can register a user (see
`e2e/helpers/auth.ts`) and search/filter the catalog (e.g. `/katalog`) against known cards instead of
depending on a full `catalog:sync` import. Set `E2E_PORT` to run the E2E server on a port other than the
default `3300` (useful when running `pnpm test:e2e` alongside `pnpm dev`).

## Production

```bash
pnpm build
pnpm preview
```

### Docker

Build and start the app with Docker Compose:

```bash
docker compose up --build
```

The app is then available at `http://localhost:3000`. The SQLite database is persisted through the `./data:/app/data` volume, so it survives container restarts.

For production, `NUXT_BETTER_AUTH_SECRET` must be set, for example through a `.env` file in the project root (automatically loaded by `compose.yaml` when present) or as an environment variable before startup:

```bash
NUXT_BETTER_AUTH_SECRET="$(openssl rand -base64 32)" docker compose up --build -d
```

## Project Structure

```
app/                  # Nuxt App (Pages, Layouts, Components, Middleware)
server/
  api/                # Server routes, including the Better Auth handler
  db/                 # Drizzle schema, DB client, and migrations
  plugins/            # Nitro plugins, including automatic migrations
  utils/              # Server-side utilities, including Better Auth setup
  tasks/              # Nitro tasks, including the catalog:sync import job
tests/nuxt/           # Vitest unit/component tests
e2e/                  # Playwright end-to-end tests
docs/                 # Product roadmap, ADRs, and additional documentation
Dockerfile            # Multi-stage build for the production container
compose.yaml          # Docker Compose setup for local/self-hosted operation
```

## Outlook

A local image proxy/cache for card artwork is planned as follow-up work and is not part of the current state (card images are currently hotlinked from YGOPRODeck).
