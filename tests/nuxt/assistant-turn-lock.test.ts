import { describe, expect, it } from 'vitest'
import { claimTurnLock, isTurnInFlight, releaseTurnLock } from '../../server/utils/assistant-turn-lock'

// Unit-level coverage for the per-user turn lock the stream endpoint
// (`server/api/assistant/chat/[id]/stream.post.ts`) uses to 409 a second
// concurrent submit — extracted specifically so this is testable without
// spinning up an HTTP server (repo convention is util-level tests).

describe('assistant turn lock', () => {
  it('is not in flight until claimed', () => {
    expect(isTurnInFlight('user-lock-1')).toBe(false)
  })

  it('reports in flight once claimed, and no longer once released', () => {
    claimTurnLock('user-lock-2')
    expect(isTurnInFlight('user-lock-2')).toBe(true)

    releaseTurnLock('user-lock-2')
    expect(isTurnInFlight('user-lock-2')).toBe(false)
  })

  it('releasing a lock that was never claimed (or already released) is a no-op, not an error', () => {
    expect(() => releaseTurnLock('user-lock-never-claimed')).not.toThrow()
    expect(isTurnInFlight('user-lock-never-claimed')).toBe(false)
  })

  it('tracks each user independently', () => {
    claimTurnLock('user-lock-a')
    expect(isTurnInFlight('user-lock-a')).toBe(true)
    expect(isTurnInFlight('user-lock-b')).toBe(false)
    releaseTurnLock('user-lock-a')
  })
})
