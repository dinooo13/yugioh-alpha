# 0013: English URL scheme and permanent redirects from German paths

## Status

Accepted

## Context

Every page URL used German slugs (`/inventar`, `/katalog`, `/spieler/:handle`,
`/formate/neu`, …), and a few query values and anchors were German too
(`/inventar?view=uebersicht`, `/decks?neu=1`, `/profil#wunschliste`).
Issue #34 makes the app bilingual and is split into three stacked parts:
F1 English route slugs with redirects (this ADR), F2 an i18n layer with a UI
language switch, F3 the card display language with bilingual search.

Old URLs are out in the wild: share links (`/spieler/<handle>/decks/<id>?token=…`,
`/spieler/<handle>/sammlungen/<id>?token=…`, `/spieler/<handle>/inventar`)
have been handed out ([ADR 0007](0007-sharing-and-profile-model.md)), and
users have bookmarks. The database stores no URLs — only share tokens and
handles; share links are built on the client from `handle + id + ?token=` —
so nothing needs migrating. `/decks/assistent`
([ADR 0011](0011-deck-assistance-in-chat.md)) was a 307 route rule to
`/assistent?intent=new-deck`.

## Decision

### Mapping

Only fixed segments are translated; dynamic segments (handles, ids) are
copied verbatim.

| Old | New |
|---|---|
| `/inventar`, `/inventar/erfassen` | `/inventory`, `/inventory/quick-entry` |
| `/katalog` | `/catalog` |
| `/assistent`, `/assistent/:id` | `/assistant`, `/assistant/:id` |
| `/decks/assistent` | `/assistant?intent=new-deck` (one hop; an existing `intent` is kept) |
| `/formate`, `/formate/neu`, `/formate/:id` | `/formats`, `/formats/new`, `/formats/:id` |
| `/wunschliste` | `/wishlist` |
| `/turniere`, `/turniere/neu`, `/turniere/:id` | `/tournaments`, `/tournaments/new`, `/tournaments/:id` |
| `/profil` | `/profile` |
| `/spieler`, `/spieler/:handle` | `/players`, `/players/:handle` |
| `/spieler/:handle/inventar` | `/players/:handle/inventory` |
| `/spieler/:handle/sammlungen/:id` | `/players/:handle/collections/:id` |
| `/spieler/:handle/decks/:id` | `/players/:handle/decks/:id` |
| `/`, `/login`, `/register`, `/decks`, `/decks/:id` | unchanged |

Query values and anchors:

- `/inventar?view=uebersicht` / `view=liste` → `/inventory?view=overview` /
  `view=list`. Only the `/inventar` redirect rewrites them; the page reads
  only the new values.
- `/decks?neu=1` → `/decks?new=1`.
- The profile's wishlist section anchor is now `#wishlist`
  (`/profile#wishlist`).
- Every other query parameter (`token`, `collectionId`, `card`, `deckId`,
  `intent`, `prompt`, `q`, `redirect`) is unchanged and passed through byte
  for byte.

URLs are language-neutral and carry no locale prefix. F2 will use
`@nuxtjs/i18n` with `strategy: 'no_prefix'` (locale from the profile, then a
cookie, then `Accept-Language`) and no translated per-locale slugs
(`customRoutes`), so a shared link is the same for every reader.

### One pure mapper, two callers

`shared/legacy-routes.ts` exports `legacyRedirectTarget(url)`: the new URL for
a legacy path (path + optional query + hash), or `null`. Fixed segments match
case-insensitively (like Vue Router), a trailing slash or `//` is ignored, and
the result always starts with a fixed English segment (never `//host`) and
never maps again, so each old URL is exactly one hop from its new one.

- **Page loads:** `server/middleware/legacy-redirects.ts` answers `GET`/`HEAD`
  for a legacy path with a `301` and `cache-control: private, no-store` —
  old `/spieler/**` URLs can carry a share token, so the redirect keeps the
  no-store posture of the former `/spieler/**` route rule (now on
  `/players/**`). Server middleware runs before the Nuxt renderer, so
  `auth.global.ts` never sees an old path. `/api/**`, `/_nuxt/**` etc. pass
  through: their first segment is not in the table. It reads h3 v1's
  `event.path`, which includes the query; revisit on Nitro 3.
- **Client navigations:** `app/middleware/00.legacy-routes.global.ts` calls
  the same mapper and does `navigateTo(target, { replace: true, redirectCode:
  301 })`. The `00.` prefix sorts it before `auth.global.ts`, whose
  `isPublicPath` only knows `/players/**` — otherwise an anonymous visitor of
  an old share link would be sent to `/login`.

Entries are never removed. A future rename adds its old path to the mapper.
The English route names (`players`, `inventory`, `catalog`, `formats`,
`tournaments`, `wishlist`, `assistant`, …) are reserved as handles next to
the German ones.

### Not chosen

- **Nitro `routeRules` redirects.** A `/**` target only swaps the prefix, so
  it can't rename a segment after a dynamic one
  (`/spieler/:handle/sammlungen/:id`); the route-rules handler runs before
  server middleware; and a string redirect defaults to 307. The old
  `/decks/assistent` rule would also have become a two-hop chain.
- **`definePageMeta({ alias })`.** Serves the page with 200 under two URLs,
  with no canonical one, and old links would never converge.
- **A data migration.** Nothing in the database is a URL.
- **Per-locale slugs or locale-prefix strategies.** They make shared links
  language-specific.

## Consequences

- An old link costs one extra request, forever.
- The old `#wunschliste` anchor is kept by the redirect but no longer
  scrolls to the wishlist section (the server never sees the fragment, and
  the section's id is now `wishlist`).
- Redirect responses are not cached, so a browser re-asks the server each
  time; in exchange a 301 can't get stuck in a browser cache.
- [ADR 0007](0007-sharing-and-profile-model.md),
  [ADR 0010](0010-chat-assistant-with-tools.md), and
  [ADR 0011](0011-deck-assistance-in-chat.md) keep the German paths as
  history.

## Relationship to other ADRs

Updates the paths named in [0007](0007-sharing-and-profile-model.md),
[0010](0010-chat-assistant-with-tools.md), and
[0011](0011-deck-assistance-in-chat.md) (the `/decks/assistent` route rule is
replaced by the mapper). Prepares #34 F2 (i18n layer) and F3 (card display
language).
