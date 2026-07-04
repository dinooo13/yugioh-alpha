---
# yugioh-alpha-gldu
title: Fix localhost login failure
status: completed
type: bug
priority: normal
created_at: 2026-07-04T17:59:27Z
updated_at: 2026-07-04T18:15:54Z
---

User reports the app is running on localhost:3000 but login does not work.\n\n- [x] Inspect existing auth implementation and expected local setup\n- [x] Reproduce or identify the failing login path\n- [x] Implement the fix\n- [x] Verify login behavior with tests or local checks

## Summary of Changes\n\nFixed localhost auth by replacing the session read path with an explicit cookie-aware helper, waiting for the session endpoint after sign-in/sign-up before navigating, refreshing the default layout session on mount, and redirecting already-authenticated users away from login/register pages. Verified with dev-browser checks, typecheck, lint, unit tests, auth e2e, and protected-route e2e.
