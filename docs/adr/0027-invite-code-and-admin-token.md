# 0027: Invite-only sign-up and an admin token for the catalog syncs

## Status

Accepted. Supersedes the session gate on `POST /api/admin/catalog/sync` from
[ADR 0001](0001-card-catalog-data-model.md) (and the same gate on
`POST /api/admin/catalog/translations/sync`, [ADR 0015](0015-german-card-data.md)).

## Context

The app is going onto a public host (`ygo-alpha.de`) for a small group of
people. Two things were fine for a local single-user tool but aren't there:

- **Anyone can register.** `/register` creates an account for every visitor.
- **Every signed-in user can run the catalog syncs.** ADR 0001 gated
  `/api/admin/catalog/sync` on "any authenticated session" and deferred a
  real admin role. With open sign-up, a stranger could create an account and
  start full YGOPRODeck syncs, which are heavy and also prune printings and
  images (ADR 0024).

The owner wants this closed with as little code and UI as possible: no email
allow-list, no admin UI, no per-user invites to hand out and track.

## Decision

1. **One shared invite code.** `runtimeConfig.inviteCode`
   (`NUXT_INVITE_CODE`) holds a single code. When it's set, a Better Auth
   `hooks.before` middleware (`server/utils/invite-code.ts`) rejects
   `POST /api/auth/sign-up/email` unless the body's `inviteCode` matches:
   403 with the code `INVALID_INVITE_CODE`, which the register page
   translates like Better Auth's own codes (ADR 0014). The code is reusable;
   changing it (edit the env, restart) shuts the door for anyone who only
   knows the old one. Existing accounts are not affected.
2. **Forgiving, constant-time comparison.** Case, spaces and dashes are
   ignored, so `k7qm-2xdp…` matches `K7QM2XDP…`. Both sides are hashed and
   compared with `timingSafeEqual` (`server/utils/secret-match.ts`). A random
   16-character code from a 32-letter alphabet is 80 bits; together with
   Better Auth's built-in rate limit on sign-up, guessing isn't practical.
3. **Unset = open sign-up.** Without `NUXT_INVITE_CODE`, sign-up works as
   before, so local development needs no setup. Production must set it. The
   E2E server sets one and the E2E helper types it in, so the whole suite
   registers through the real check.
4. **The register form always shows the field.** One optional "Einladungscode"
   input; the page doesn't know whether the server wants a code, and a public
   flag for that isn't worth the extra plumbing. Locally the field can stay
   empty.
5. **The admin endpoints need a bearer token, not a session.**
   `/api/admin/catalog/sync` and `/api/admin/catalog/translations/sync` call
   `requireAdminToken()` (`server/utils/admin-token.ts`): they need
   `Authorization: Bearer <NUXT_ADMIN_TOKEN>`, 401 otherwise, and answer 403
   to everyone when no token is configured. No page calls these endpoints,
   so nothing in the UI changes; the dev-only `/_nitro/tasks/...` runners
   stay as they are.

## Consequences

- No schema change and no migration: the code and the token live in the
  environment.
- An admin *role* is still not modelled. Whoever holds the token is the
  admin; that's the owner running `curl`.
- The invite code can't be revoked for a single person, only replaced for
  everyone. Accepted for a small group.
- Forgetting `NUXT_INVITE_CODE` in production silently reopens sign-up. The
  deployment notes in the README call it out.
