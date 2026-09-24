# 0014: UI internationalisation (German and English)

## Status

Accepted

Implemented: F2 is complete with F2d (the assistant, the final gates and
Accept-Language detection switched on). The whole UI is translated,
`no-raw-text` covers `app/**/*.vue`, `~~/shared/plural` is off-limits in
`app/`, and `tests/nuxt/no-hardcoded-copy.test.ts` scans `app/` and
`shared/` for German literals. The assistant's model-facing text is English
with a per-turn reply-language instruction; its tool activity, actions and
errors reach the UI as structured values (codes, counts, ids — deck names
resolved for display, #53).

## Context

Issue #34 makes the app bilingual. F1 moved every page to language-neutral
English URLs ([ADR 0013](0013-english-url-scheme.md)): no locale prefix and
no translated slugs, so a shared link is the same for every reader. F2 adds
the interface language itself; F3 adds a card display language.

The German copy sits in many places: page and component templates, label
maps in `shared/` (`VISIBILITY_LABELS`, `TOURNAMENT_STATUS_LABELS`, …), the
server (deck validation messages, the built-in format names, the rule
describer, assistant error texts and fallback replies) and the assistant's
prompt and tool descriptions. `apiErrorMessage()` shows a server
`statusMessage` verbatim, and most of those are already English, so English
leaks into the German UI today.

There are three separate "language" concepts, and they must not be mixed:

- the **interface language** — menus, buttons, messages (this ADR);
- the **card language** — which name and text a card is shown with (F3);
- the **printing language** — a property of an owned copy (ADR 0002).

F2 ships as four stacked PRs: F2a (foundation, app shell, auth, profile,
dashboard), F2b (collection side), F2c (decks, formats, tournaments,
validation), F2d (assistant, final gates).

## Decision

### 1. Library

- `@nuxtjs/i18n` 10.4 (vue-i18n 11), pinned to `~10.4.1`: 10.5+ needs
  `@nuxt/kit ^4.5` and `vue-router ^5.2`, newer than this repo's Nuxt 4.4.
- `strategy: 'no_prefix'` (ADR 0013) and `detectBrowserLanguage: false`: the
  module switches languages and loads catalogues, but never decides which
  language a request gets and never redirects.
- Catalogues are JSON per namespace, `i18n/locales/{de,en}/<namespace>.json`,
  each with exactly one top-level key equal to the namespace
  (`app`, `common`, `errors`, `auth`, `profile`, `dashboard`, `inventory`,
  `quickEntry`, `catalog`, `collections`, `wishlist`, `sharing`, `players`,
  `card`, `decks`, `formats`, `validation`, `tournaments`, `assistant`;
  the list lives in `i18n/namespaces.ts`). The module lazy-loads them per
  locale from `/_i18n/<hash>/<locale>/messages.json`.
- Nuxt UI's own strings follow along: `app.vue` binds `UApp :locale` to the
  active language and sets `<html lang>`.
- Key conventions: `<namespace>.<componentOrSection>.<element>` in camelCase;
  keys built from an enum end in the raw value (`card.condition.near_mint`);
  every key is a full sentence with named parameters (links inside text via
  `<i18n-t>`); `common` holds only generic actions. English copy uses US
  spelling and sentence case; game terms (Main/Extra/Side Deck, ATK/DEF,
  TCG/OCG) stay.

### 2. Locales

`shared/locale.ts` defines `APP_LOCALES = ['de', 'en']`, `AppLocale`, and
`DEFAULT_APP_LOCALE = 'de'`, which is also the vue-i18n fallback. Adding a
language means a new code there, a new `i18n/locales/<code>/` folder, and
one Nuxt UI locale import in `app.vue`.

### 3. Resolution

Order: the signed-in user's **profile** choice, then the **`ui_locale`
cookie**, then **Accept-Language** (primary subtag, by quality, `q=0`
ignored), then **German**. An unsupported language falls through.

- `server/utils/ui-locale.ts` `resolveUiLocale(event)` runs at most once per
  request and caches the result on `event.context`. A Nitro plugin installs
  it lazily as `event.context.resolveUiLocale`, so API and asset requests
  never pay for the session and profile lookup; rendered HTML gets
  `Vary: accept-language, cookie`.
- The app plugin `app/plugins/ui-locale.ts` (after the module's plugins)
  calls it during SSR, renders in that language, and hands the choice to the
  client in `useState`, so hydration starts in the same language — no flash
  and no hydration mismatch.
- When the profile decided, the plugin writes that language into the cookie,
  so it survives a sign-out on that browser. A profile choice always beats
  the cookie.
- Accept-Language detection is behind `DETECT_ACCEPT_LANGUAGE` and stays
  **off until F2d**, so an English browser doesn't get a half-translated UI
  while the extraction is in progress.

### 4. Storage

- `user_profile.locale`, nullable text, no default; `null` means "not
  chosen". Migration 0011 is a plain `ALTER TABLE user_profile ADD locale
  text`, no table rebuild.
- `PATCH /api/profile { locale }` sets it (`null` resets it); anything else
  is a 400 with `data.code = 'invalid_locale'`. `OwnProfile.locale` returns
  it.
- Cookie `ui_locale`: one year, `SameSite=Lax`, `Path=/`, not httpOnly (the
  switch writes it on the client). It is written for signed-in users too.
- Not the better-auth `user` table: app preferences belong to the profile
  ([ADR 0007](0007-sharing-and-profile-model.md)), and the auth schema stays
  generated.
- The switch ("Anzeigesprache / Interface language") sits in a settings card
  on `/profile` and, compact, on the auth and public layouts. Signed in, it
  saves to the profile first and only switches when that succeeds.

### 5. What is translated where

- **All UI copy lives in the client catalogues.** `shared/` keeps value lists
  only, no labels, and never imports i18n. Components and composables use
  `const { t, n, d } = useI18n()`; plain functions in `app/utils` return keys
  or take `t`.
- **The server never produces UI copy.** A `statusMessage` is technical
  English; user-facing errors carry `data.code`, and the client translates
  `errors.api.<code>` (`useApiError()`), falling back to a generic message.
  A raw `statusMessage` is never rendered. better-auth errors map their
  `error.code` to `auth.errors.<CODE>` the same way.
- **Domain messages are code + parameters**, rendered on the client (deck
  validation issues and warnings, F2c).
- **Text the model reads is English** and exists once (system prompt, tool
  descriptions, tool results); a per-turn instruction sets the reply language
  from the request's interface language (F2d). Assistant fallback text that
  is saved as message content is localised when it is created.
- **Built-in formats** are translated on the client by id; **user content**
  (deck, collection and format names, bios) is never translated. **Card
  data** stays as it is until F3.
- **Formatting** uses `n()` / `d()` with named formats (`integer`, `date`,
  `dateTime`) instead of hard-coded `de-DE`; **plurals** use vue-i18n
  (`"{count} Karte | {count} Karten"` via `useCount()`), replacing
  `pluralize`.
- **Page titles** go through `usePageTitle(key)` → `"{page} – yugioh alpha"`.
- The **PWA manifest stays static** (`lang: 'de'`): it is fetched once at
  install and cached; a per-locale manifest would need a dynamic route and
  would still not follow a later switch.

### 6. Terminology

| German | English |
|---|---|
| Anzeigesprache | Interface language |
| Kartensprache | Card language (F3) |
| Drucksprache | Printing language |

### 7. Quality gates

- A catalogue test (`tests/nuxt/i18n-messages.test.ts`): per namespace, de
  and en have the same keys, no empty values, every message compiles, and a
  plural in one language is a plural in the other.
- ESLint `@intlify/vue-i18n`: `no-missing-keys` and `valid-message-syntax`
  everywhere; `no-raw-text` on the files already extracted (a ratchet list,
  `EXTRACTED_FILES`, that each F2 PR extends and F2d replaces with
  `app/**/*.vue`).
- A scan for hard-coded German in `app/` and `shared/` (F2d).
- Playwright is pinned to `locale: 'de-DE'` (Chromium would send
  `Accept-Language: en-US`); unit tests run in German by default and add one
  English case per converted area.

## Not chosen

- **Translating errors on the server by request locale.** It would couple
  every endpoint to the locale resolution and still leave client-side
  messages; codes keep the server language-free.
- **The module's own browser detection and cookie** (`i18n_redirected`). It
  doesn't know the profile, and its redirect logic is built for prefixed
  routes.
- **Locale-prefixed URLs or translated slugs** — ADR 0013: links must be the
  same for every reader.
- **A manifest per locale** — see above.
- **Translating the prompt and tool descriptions per locale.** Two versions
  drift; the model reads English reliably and replies in the language it is
  told.
- **Typed messages** (`experimental.typedOptionsAndMessages`). In 10.4 the
  types are only generated by a running dev server, so `nuxt typecheck` in CI
  would never see them. The catalogue test and `no-missing-keys` cover
  missing keys instead.

## Consequences

- Between F2a and F2d, English mode is mixed German/English; that is
  acceptable only because Accept-Language detection stays off, so only users
  who pick English see it.
- Every new UI string needs a German and an English entry; the lint rules and
  the catalogue test enforce it.
- Unit tests assert German by default; English cases switch with
  `setTestLocale('en')` and reset afterwards.
- The first page load fetches the active catalogue (`/_i18n/…`) before
  hydration; it is cached briefly and hashed per build.
- For F3: `AppLocale` is reused for `catalog_card_translation.locale` and a
  future nullable `user_profile.card_locale` (`null` = follow the interface
  language); a card-locale resolver sits next to `resolveUiLocale`, and F3
  changes the card-name sentence of the assistant's reply instruction.

## Relationship to other ADRs

Builds on [0013](0013-english-url-scheme.md) (`no_prefix`, no translated
slugs). Extends the profile of [0007](0007-sharing-and-profile-model.md)
with `locale`. Keeps the printing language of
[0002](0002-owned-card-inventory-data-model.md) separate from the interface
and card languages.
