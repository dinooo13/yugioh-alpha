# 0007: Sharing and profile model

## Status

Accepted

## Context

- Phase 6 of the Roadmap: user profiles, collection/deck sharing permissions, shared links or
  selected-user access, viewing another user's shared cards or decks, optional trade/wishlist.
  Sharing modes named in the vision: private, shared with selected users, shared by link, public.
- Existing constraints: better-auth owns the `user` table (schema generated for the Drizzle
  adapter); ADR 0002 and ADR 0004 established "every write is scoped by session user id, foreign
  resources are 404, not 403"; decks derive availability from the *owner's* inventory at read time
  (ADR 0004), which is exactly the data a shared view must not disclose.
- Until now every domain endpoint required a session (`requireUser`). Link sharing breaks that
  assumption: a shared resource must be readable without an account.

## Decision

- **Profile is a separate table.** `user_profile` (userId PK/FK cascade, unique `handle`,
  `displayName`, `bio`, inventory/wishlist visibility) instead of columns on `user`. Created
  lazily on first authenticated read, so no backfill and no signup hook.
- **`handle` is the public identity.** All shared routes are `/spieler/:handle/...`; ids stay
  opaque UUIDs. One URL scheme for link-shared and profile-listed resources.
- **Two orthogonal axes.** `visibility ∈ {private, link, public}` plus a nullable unique
  `shareToken` on the resource; `share_grant` rows for "selected users". A resource can be private
  and granted, or public and still have a token.
- **One generic grant table** keyed by `(resourceType, resourceId, grantedUserId)`;
  `resourceType ∈ {deck, collection, inventory}` with the whole inventory addressed by the owner's
  user id. `resourceId` is polymorphic and therefore FK-less; grants are deleted explicitly with
  the resource.
- **One access function.** `resolveAccess` (owner | public | grant | token) is the single place any
  read is authorized. Failures are 404, never 403.
- **Tokens.** 128-bit random, base64url, regenerable, nulled when a resource goes private (old
  links die). Compared in constant time. Honoured for `link` *and* `public`.
- **Read-only projections.** Shared views are built by `server/utils/shared-views.ts`, never by
  reusing the owner-side detail builders: the shared deck view carries quantities, counts, format
  and legality but no `owned`/`usedInDeck`/`shortfall`; shared card lists aggregate per catalog
  card and drop notes, conditions and cross-collection breakdowns.
- **`getOptionalUser`** next to `requireUser`: a session widens what is visible, it is never
  required for `link`/`public` reads. `/spieler/**` is added to the route middleware's public
  prefixes.
- **Wishlist included, trading excluded.** `wishlist_item` (unique per user+card, quantity, note)
  with a `/wunschliste` page and a public-or-private toggle on the profile. Trading is deferred:
  it needs negotiation state, notifications and a dispute story, and the roadmap calls it optional.
- **Rejected alternatives:** columns on better-auth's `user`; a second `/geteilt/...` URL family;
  per-resource grant tables; reusing `getDeckDetail`/`listOwnedCards` for shared views; JWT-style
  signed share links (no revocation without a server-side list, which is the token column anyway).

## Consequences

- Any future shareable resource is `visibility` + `shareToken` + a `resourceType` value; the share
  modal, the grant API and `resolveAccess` are reused unchanged.
- The whole inventory is shareable without inventing an "Alle Karten" row, keeping ADR 0002's
  "the unfiltered inventory is not a stored collection" intact.
- Grants are not FK-enforced; a missed `deleteGrantsForResource` call leaves rows that grant access
  to nothing. Covered by an API test on `deleteDeck`.
- Share tokens live in URLs: shared pages send `Referrer-Policy: no-referrer`, `robots: noindex`
  and `Cache-Control: private, no-store`. Anyone holding the link has access — that is the feature.
- Revoking is immediate for grants and for "private"; regenerating a link invalidates previously
  copied URLs.
- Handles are a new global namespace; reserved names are blocked so a handle can never shadow a
  top-level route.
- Public read endpoints are the first unauthenticated domain surface; every one of them is a `GET`
  with no body, so no write path is reachable without `requireUser`.
