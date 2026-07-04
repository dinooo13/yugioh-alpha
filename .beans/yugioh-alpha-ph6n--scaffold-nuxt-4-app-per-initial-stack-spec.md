---
# yugioh-alpha-ph6n
title: Scaffold Nuxt 4 app per initial stack spec
status: todo
type: task
priority: normal
created_at: 2026-07-04T15:18:23Z
updated_at: 2026-07-04T15:27:00Z
---

Walking-skeleton scaffold for the Yu-Gi-Oh card app (see docs/Roadmap.md, Phase 1). This bean carries the full initial-stack specification decided in the /spec brainstorming session on 2026-07-04. The visual design (Claude design handoff, 2026-07-04) is documented in the Design Reference section below.

## Stack Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Platform | Responsive web app / PWA | One codebase for desktop + phone; PWA keeps camera-based card entry (Phase 2) possible without an app store |
| Framework | Nuxt 4 (Vue 3, Nitro) | Full-stack Vue: file-based routing, server routes, strong module ecosystem |
| UI | Nuxt UI v4 (Tailwind CSS v4 + Reka UI) | Official component library; tables, forms, command palette, dark mode out of the box |
| Database | SQLite (file in Docker volume) | Zero-ops for a personal app; migrate to Postgres if multi-user features get serious |
| ORM | Drizzle ORM + drizzle-kit migrations | Lightweight, type-safe, SQL-first |
| Auth | Better Auth, email/password | Self-hosted TS auth, owns its tables in the DB via Drizzle adapter, no vendor lock-in |
| Card catalog | Periodic sync of YGOPRODeck full card dump (~13k cards) into local SQLite | Fast local search/filtering, offline-capable, rule formats can query card properties directly |
| Card images | Lazy-cache proxy: Nitro route downloads from YGOPRODeck on first request, serves locally after | YGOPRODeck ToS forbids hotlinking (IP blacklist); avoids multi-GB upfront download |
| PWA | @vite-pwa/nuxt from day one | Manifest + basic service worker; cheap now, fiddly to retrofit |
| Hosting | Self-host via Docker | Node server + volume for SQLite/images; simplest fit for SQLite |
| Tooling | pnpm, TypeScript strict, @nuxt/eslint, Vitest + @nuxt/test-utils, Playwright E2E, GitHub Actions CI | Standard kit + E2E from the start |

## Architecture Notes

- Single Nuxt 4 app: `app/` directory for frontend, `server/` (Nitro) for API routes, `server/db/` for Drizzle schema + client.
- SQLite file path from env var (default `./data/app.db`); `./data` is the Docker volume (DB + cached images).
- Better Auth via Drizzle adapter with catch-all route `server/api/auth/[...all].ts`; auth route middleware protects app pages.
- Catalog sync job and image lazy-cache proxy are documented here as the agreed strategy but are follow-up beans, NOT part of this scaffold.

## Scaffold Checklist

- [ ] Init Nuxt 4 project with pnpm, TypeScript strict
- [ ] Add Nuxt UI v4
- [ ] Add @nuxt/eslint
- [ ] Wire Drizzle + SQLite (better-sqlite3) + first migration via drizzle-kit
- [ ] Integrate Better Auth: register/login/logout pages + route middleware
- [ ] Add @vite-pwa/nuxt with manifest + basic service worker
- [ ] Vitest + @nuxt/test-utils setup with one smoke test
- [ ] Playwright setup with auth happy-path E2E (register → login → logout)
- [ ] Dockerfile (multi-stage) + compose.yaml with `./data` volume + .env.example
- [ ] GitHub Actions CI: lint, typecheck, test
- [ ] App shell per design: sidebar layout (Dashboard, Inventar, Decks, Formate, Turniere as placeholder routes), Cardex branding, indigo/violet primary theme, German labels
- [ ] README quickstart

## Test Plan

| # | Test Case | Type | Expected |
|---|-----------|------|----------|
| 1 | `pnpm dev` boots the scaffold | manual | App serves on localhost without errors |
| 2 | Lint, typecheck, unit tests | CI | All pass |
| 3 | Register → login → logout | Playwright E2E | Happy path succeeds |
| 4 | Visit protected route unauthenticated | Playwright E2E | Redirect to login |
| 5 | Docker image builds and serves | manual | `docker compose up` serves the app, DB persists in volume |
| 6 | PWA manifest served | manual/E2E | `/manifest.webmanifest` reachable, installable |

## Out of Scope

- Catalog sync implementation (YGOPRODeck import job)
- Image lazy-cache proxy implementation
- Inventory/collections CRUD, deckbuilder, rule formats
- AI assistance, sharing/social, tournaments
- OAuth providers (email/password only for now)
- Postgres migration
- Inventory grid, card detail panel, filters, stats (design documented below; feature work for follow-up beans)

## Design Reference (Claude design, 2026-07-04)

App name: **Cardex**. Light theme, near-white neutral background, white cards with subtle borders and rounded corners, indigo/violet primary (~#6D5DF6). UI language: **German** (single language for now, no i18n framework needed yet).

### Layout

Three-column desktop layout:

```
+----------+--------------------------------------+---------------+
| Sidebar  |  Main content                        | Detail panel  |
| (nav +   |  (page header, stats, filters,       | (selected     |
|  collec- |   card grid)                         |  card)        |
|  tions)  |                                      |               |
+----------+--------------------------------------+---------------+
```

- **Sidebar**: Cardex logo (purple rounded-square mark); nav items Dashboard, Inventar, Decks, Formate, Turniere; section "SAMMLUNGEN" listing collections with colored dots and card counts (Alle Karten, Box 1, Box 2, Binder, Trade Pile); footer action "+ Neue Sammlung".
- **Inventory page ("Inventar")**: title with subtitle "N Karten · M Unikate"; search input "Karten durchsuchen..."; primary button "+ Karte hinzufügen"; four stat cards: Karten gesamt, Unikate, Format-legal (% + format name), Sammlungswert (€); filter chip row: Typ / Attribut / Set dropdowns, "Nur im Besitz" toggle chip, right-aligned "Sortieren: <field>".
- **Card grid**: tiles with card image, top-left type badge with colored dot (Normal/Effekt/Zauber/Falle), top-right quantity badge (×N), card name, sub-line with ATK/DEF · Stufe or card category (Zauber · Schnell, Falle · Normal).
- **Card detail panel ("KARTENDETAIL")**: closable; card image, name, type chips (e.g. "Effekt · Zombie"), attribute/level line (FEUER · Stufe 3), ATK/DEF; ownership block: Im Besitz (Exemplare), Lagerort (collections), In Decks (count), format legality badge (e.g. "Limitiert · max 1"); EFFEKT text section; primary button "Zu Deck" + secondary export/download icon button.

### Implications for the scaffold

- App display name/branding is **Cardex** (repo stays yugioh-alpha).
- Nuxt UI theme: primary indigo/violet; light mode default (dark mode can stay available via Nuxt UI).
- App shell = sidebar layout above with the five nav items as (mostly placeholder) routes; German nav labels.
- Sammlungswert implies card pricing data — YGOPRODeck dump includes prices; note for the catalog-sync follow-up bean, not the scaffold.
- Inventory grid/detail panel/filters are feature work for follow-up beans; the scaffold only delivers the shell layout and theming.
