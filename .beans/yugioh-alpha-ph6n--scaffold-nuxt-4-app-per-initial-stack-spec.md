---
# yugioh-alpha-ph6n
title: Scaffold Nuxt 4 app per initial stack spec
status: todo
type: task
created_at: 2026-07-04T15:18:23Z
updated_at: 2026-07-04T15:18:23Z
---

Walking-skeleton scaffold for the Yu-Gi-Oh card app (see docs/Roadmap.md, Phase 1). This bean carries the full initial-stack specification decided in the /spec brainstorming session on 2026-07-04. A visual design from Claude design will follow separately — do not lock in visual design details; build with stock Nuxt UI components until the design handoff.

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
- Visual design — pending Claude design handoff; use stock Nuxt UI components until then
