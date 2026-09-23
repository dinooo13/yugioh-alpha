// Per-user "one chat turn in flight at a time" guard used by
// `POST /api/assistant/chat/:id/messages` (see docs/adr/0010's "Loop limits"
// decision — an in-memory, process-local, module-level lock, the shape the
// former one-shot deck assistant endpoint used too). Extracted out of the endpoint file so its
// acquire/release semantics can be unit tested directly (repo convention:
// util-level tests, not a spun-up HTTP server) — see
// tests/nuxt/assistant-turn-lock.test.ts.

const usersInFlight = new Set<string>()

/** Whether the given user already has a turn running. */
export function isTurnInFlight(userId: string): boolean {
  return usersInFlight.has(userId)
}

/** Claims the lock. Call only right after `isTurnInFlight` returned `false` — with nothing awaited in between, so no other request can observe the gap. */
export function claimTurnLock(userId: string): void {
  usersInFlight.add(userId)
}

/** Releases the lock. Safe to call even if it was never claimed (or already released) for this user. */
export function releaseTurnLock(userId: string): void {
  usersInFlight.delete(userId)
}
