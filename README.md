# yugioh alpha

Verwaltung für Yu-Gi-Oh!-Sammlungen, Decks, Formate und Turniere. Gebaut mit [Nuxt 4](https://nuxt.com) und [Nuxt UI](https://ui.nuxt.com).

## Voraussetzungen

- Node.js 22 oder neuer
- pnpm 11 über [Corepack](https://nodejs.org/api/corepack.html) (in Node ab 16.13 enthalten)

```bash
corepack enable
```

## Setup

```bash
pnpm install
```

Umgebungsvariablen konfigurieren (optional für die lokale Entwicklung, mit unsicheren Standardwerten funktioniert es auch ohne):

```bash
cp .env.example .env
```

Siehe [`.env.example`](./.env.example) für alle verfügbaren Variablen:

- `NUXT_BETTER_AUTH_SECRET` – Secret für Better Auth (in Produktion zwingend erforderlich, z. B. `openssl rand -base64 32`)
- `NUXT_PUBLIC_BETTER_AUTH_URL` – öffentlich erreichbare Basis-URL der App
- `NUXT_DB_FILE_PATH` – Pfad zur SQLite-Datenbankdatei (Standard: `./data/app.db`, Verzeichnis wird automatisch angelegt)

## Entwicklung

Dev-Server auf `http://localhost:3000` starten:

```bash
pnpm dev
```

## Datenbank / Migrationen

Drizzle-Migrationen liegen in `server/db/migrations` und werden **beim Serverstart automatisch angewendet** (`server/plugins/migrate.ts`) – für die normale Entwicklung und den Produktivbetrieb ist kein manueller Schritt nötig.

Bei Schemaänderungen manuell eine neue Migration erzeugen bzw. anwenden:

```bash
pnpm db:generate   # neue Migration aus server/db/schema.ts erzeugen
pnpm db:migrate    # Migrationen manuell anwenden
```

## Qualitätschecks

```bash
pnpm lint
pnpm typecheck
```

## Tests

Unit-/Komponententests (Vitest, `tests/nuxt/`):

```bash
pnpm test
```

End-to-End-Tests (Playwright, Chromium, `e2e/`) – bauen die App und starten sie gegen eine separate Test-Datenbank in `e2e-data/`:

```bash
pnpm test:e2e
```

## Produktion

```bash
pnpm build
pnpm preview
```

### Docker

Die App lässt sich per Docker Compose bauen und starten:

```bash
docker compose up --build
```

Die App ist danach unter `http://localhost:3000` erreichbar. Die SQLite-Datenbank wird über das Volume `./data:/app/data` persistiert – sie bleibt also über Container-Neustarts hinweg erhalten.

Für Produktion muss `NUXT_BETTER_AUTH_SECRET` gesetzt werden, z. B. über eine `.env`-Datei im Projektwurzelverzeichnis (wird von `compose.yaml` automatisch geladen, falls vorhanden) oder als Umgebungsvariable vor dem Start:

```bash
NUXT_BETTER_AUTH_SECRET="$(openssl rand -base64 32)" docker compose up --build -d
```

## Projektstruktur

```
app/                  # Nuxt App (Pages, Layouts, Components, Middleware)
server/
  api/                # Server-Routen (u. a. Better-Auth-Handler)
  db/                 # Drizzle-Schema, DB-Client und Migrationen
  plugins/            # Nitro-Plugins (u. a. automatische Migrationen)
  utils/              # Server-seitige Utilities (u. a. Better-Auth-Setup)
tests/nuxt/           # Vitest Unit-/Komponententests
e2e/                  # Playwright End-to-End-Tests
docs/                 # Produkt-Roadmap und weitere Dokumentation
Dockerfile            # Multi-Stage-Build für den produktiven Container
compose.yaml          # Docker-Compose-Setup für den lokalen/self-hosted Betrieb
```

## Ausblick

Kartenkatalog-Synchronisierung (z. B. über eine externe Yu-Gi-Oh-Karten-API) und ein Bild-Proxy für Kartenbilder sind als Folgearbeit geplant und noch nicht Teil dieses Standes.
