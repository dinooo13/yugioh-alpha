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
returned as `warnings` rather than enforced — Phase 4 rule formats will make
them configurable. Only structurally invalid writes (unknown card, unknown
section, negative quantity, card in a forbidden section) are rejected.

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
