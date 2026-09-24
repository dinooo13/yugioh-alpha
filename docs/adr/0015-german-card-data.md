# 0015: German card data and card display language

## Status

Accepted

Implemented: F3a (the data layer — schema, name folding, the translation
sync, fixtures). F3b (bilingual search), F3c (card language setting and
German display) and F3d (card data labels, the assistant) follow and add
their status notes here.

Implemented: F3a, F3b. F3b puts every card name search behind one helper,
`cardNameMatches()` / `cardTextMatches()` in
`server/utils/card-name-search.ts` (decision 6), and gives quick entry a
German candidate pool on `catalog_card_translation.name_search`; entry
candidates carry `nameDe`.

## Context

Issue #34 makes the app bilingual. F1 gave it language-neutral URLs
([ADR 0013](0013-english-url-scheme.md)), F2 an interface language
([ADR 0014](0014-ui-internationalisation.md)). F3 adds the **card language**:
which name and text a card is shown with, and finding a card by its German
name. ADR 0014 keeps it apart from the interface language and from the
printing language of an owned copy ([ADR 0002](0002-owned-card-inventory-data-model.md)).

The catalog comes from YGOPRODeck ([ADR 0001](0001-card-catalog-data-model.md))
and is English only. The research on #34 compared German sources:

- **YGOPRODeck `language=de`** stopped being maintained around September 2022
  (a handful of cards per year since), and its Pendulum texts stay half
  English.
- **The ygoresources API** has current official German names, but its terms
  ask not to crawl the whole database.
- **The ygoresources card-history git repo**
  (`db-ygoresources-com/yugioh-card-history`) publishes Konami's official card
  text as one JSON file per card and language (`de/<konamiId>.json`: `name`,
  `effectText`, `pendEffect`, type line, attribute, stats), is updated several
  times a month, and covers the newer cards. It is keyed by **Konami id**, not
  passcode; YGOPRODeck's `misc_info[].konami_id` links the two. It has no
  licence file and no README.

The GitHub tarball of that repo is about 15 MB gzip but about 170 MB
uncompressed (ten languages); `de/` alone is about 13,800 files.

SQLite's `LIKE` ignores case only for ASCII: "BLAUÄUGIGER" doesn't match
"Blauäugiger", and about 3,100 German names contain an umlaut or `ß`.

## Decision

### 1. A second data source, for German only

The card-history repo provides German **names and texts** only. YGOPRODeck
stays the source for everything else — stats, sets, printings, rarities,
prices and the (English) images — and for the English name and text, which
stay on `catalog_card` as the canonical values.

The join key is `catalog_card.konami_id`, taken from YGOPRODeck's
`misc_info[0].konami_id` by the card sync. It is indexed but **not unique**:
one Konami id may map to several passcodes, and each of them gets the
translation. A card without a Konami id or without a German file has no
German data and falls back to English.

### 2. Schema (migration 0012, additive only)

- `catalog_card.konami_id` (integer, nullable, indexed) and
  `catalog_card.name_search` (text, not null, default `''`).
- New `catalog_card_translation`: `card_id` (FK to `catalog_card`, cascade),
  `locale` (`AppLocale`), `name`, `name_search`, `desc` (nullable), `source`
  (`'ygoresources-git'`), `synced_at`; primary key `(card_id, locale)`; a
  covering index `(locale, name_search, card_id)` for name search.
- `catalog_sync` gains `source` (default `'ygoprodeck'`, so old rows stay
  correct) and `revision` (the commit SHA of a translation run); `status`
  may now also be `skipped`.

The migration is `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD` only —
no table rebuild. `name_search` of existing cards is filled at startup
(`backfillCatalogNameSearch`, after the migrations; a no-op afterwards).
`konami_id` only arrives with the next `catalog:sync`.

### 3. Name folding

`foldCardName()` (`shared/card-name-fold.ts`) produces the stored
`name_search` and is applied to queries the same way: spell out `ß`/`ẞ` → `ss`,
`æ` → `ae`, `œ` → `oe`, `ø` → `o`, `ł` → `l`, `đ` → `d`; NFKD; drop combining
marks; lowercase; drop everything that isn't a letter or digit. "Blauäugiger
w. Drache" becomes `blauaugigerwdrache`, "Blue-Eyes" and "blue eyes" both
`blueeyes`. The result never contains `%` or `_`, so it goes into a `LIKE`
pattern unescaped; an empty result means "don't search the folded columns".

Not chosen: folding `ä` → `ae` as well (then "Blauaugiger" wouldn't match,
and German keyboards type the umlaut anyway), a custom SQLite function (every
connection, test and tool would need it registered), and FTS5 (a second index
to keep in sync, for about 28,000 names that a covering-index `LIKE` handles).

### 4. The translation sync

`syncCardTranslations()` (`server/utils/card-translations-sync.ts`):

1. Logs a `catalog_sync` run (`source = 'ygoresources-git'`).
2. Asks the GitHub API for the head commit of `main` (one request,
   `Accept: application/vnd.github.sha`, 15 s timeout). When it equals the
   `revision` of the last successful run, the run is `skipped` — no download.
3. Needs Konami ids in the catalog; without any it fails with "catalog has no
   konami ids; run catalog:sync first" and records no revision.
4. Downloads the tarball **of that commit** from codeload (not counted against
   the API rate limit; 120 s timeout) and **streams** it through
   `readTarGzEntries()` (`server/utils/tar-gz-reader.ts`): gunzip plus a small
   ustar/pax parser that keeps only accepted entries (`<root>/de/<id>.json`,
   each capped at 256 KB) and skips everything else unbuffered. A truncated
   download or a corrupt header throws.
5. Validates each file (`name` a non-empty string, `effectText`/`pendEffect`
   optional strings; invalid files are counted and skipped), normalises line
   endings, and lays out Pendulum cards like YGOPRODeck's English:
   `[ Pendeleffekt ]\n…\n\n[ Monstereffekt ]\n…`.
6. Writes only after the whole archive was read and at least 5,000 valid files
   were found: upserts one row per matching passcode in transactions of 500,
   then deletes this source's rows that the run didn't touch (files that
   disappeared). Any failure before that leaves the existing translations as
   they were.

The run's result reports `files`, `rows`, `unmappedFiles` (Konami ids without
a catalog card), `invalidFiles` and `cardsWithoutKonamiId`.

Not chosen: the GitHub compare API for incremental updates (capped at 300
files, needs rename handling and one raw request per changed file), a git
clone on the server, `nanotar` (buffers the whole 170 MB) and `tar-stream`
(a new core dependency for about 150 lines of parsing).

### 5. When it runs

- `refreshCatalog()` — behind `catalog:sync` and `POST /api/admin/catalog/sync`
  — runs the YGOPRODeck sync and then the translation sync **with `force`**
  (cards the card sync just added may have German files at an unchanged
  commit). The translation part is best effort: its failure is logged and
  returned under `translations`, the card result stands. `syncCatalog` itself
  is unchanged.
- On its own: the task `catalog:sync-translations` and
  `POST /api/admin/catalog/translations/sync` (same session check as the
  existing admin endpoint), which honour the SHA check.
- No schedule and no startup run, as in ADR 0001. After deploying, run
  `catalog:sync` once. A Nitro `scheduledTasks` entry is a possible follow-up.

### 6. Card language, API shape and search (F3b–F3d)

- **Setting:** `user_profile.card_locale`, nullable; `null` follows the
  interface language. Anonymous visitors follow the interface language.
- **API:** the server keeps `name`/`desc` as the English values and always
  adds `nameDe` (and `descDe` in detail views), whoever asks; the client picks
  what to show. Only sorting by name needs the card language on the server.
  Not chosen: replacing `name`, or a server-resolved `localName` — English
  stays the key that inventory, decks, formats and the assistant use.
- **Search is always bilingual:** the raw English `name` (`LIKE`, which also
  covers rows whose `name_search` is still `''`), `catalog_card.name_search`
  and `catalog_card_translation.name_search`, whatever the display language.
- **Card data labels** (type, attribute, race) follow the card language through
  i18n maps; rarity and set names stay English.

### 7. Licence and attribution

The repo has no licence, and the text is Konami's. The source is isolated —
its own table, its own sync, its own `source` value — so the exit path is
simple: stop syncing (and delete the rows), and every card shows English
again. The README credits the source; F3c adds a credit to the card detail
view.

## Consequences

- One real run (September 2026, demo database with 14,572 cards): 13,844
  German files read, 13,841 rows written, 3 unmapped files, 0 invalid, 270
  cards without a Konami id (206 current cards — tokens, skills, pre-release
  entries — and 64 rows YGOPRODeck no longer lists); about 5 s for the
  translation part, server RSS up by about 50 MB at the peak; a second run
  was `skipped` in under a second. The database grew by about 8 MB for the
  translation table and its indexes.
- One GitHub API request per translation run (60/hour without a token).
- `konami_id` stays empty until the first `catalog:sync` after deploying; the
  standalone translation sync fails with a clear error until then.
- German text search (`desc LIKE`) stays case-sensitive for umlauts; names are
  folded and don't have that problem.
- German set codes (`LOB-G…`, `…-DE…`) are not in the repo and stay out of
  scope.
- Tests and CI never touch the network: the syncs take injected fetchers, a
  tarball builder produces archives in memory, and the E2E catalog fixture
  carries German names and texts for all fixture cards but Raigeki (the
  fallback case).

## Relationship to other ADRs

Extends [0001](0001-card-catalog-data-model.md) (a second, supplementary
source; the YGOPRODeck import itself is unchanged, and it is not superseded).
Uses the `AppLocale` of [0014](0014-ui-internationalisation.md) for
`catalog_card_translation.locale` and the card language. Keeps the printing
language of [0002](0002-owned-card-inventory-data-model.md) separate.
