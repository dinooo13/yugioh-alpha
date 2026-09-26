// Invite-only sign-up (ADR 0027): a real Better Auth instance over an
// in-memory database, driven through its HTTP handler.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { createAuth } from '../../server/utils/auth'
import { inviteCodeMatches, normalizeInviteCode } from '../../server/utils/invite-code'

const BASE_URL = 'http://localhost:3000'
const INVITE_CODE = 'K7QM-2XDP-9HVR-4TNB'

function setup(inviteCode: string) {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  const auth = createAuth({ db, secret: 'invite-code-test-secret-not-for-production', baseURL: BASE_URL, inviteCode })

  async function signUp(extra: Record<string, unknown> = {}) {
    const response = await auth.handler(new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': BASE_URL },
      body: JSON.stringify({ name: 'Invitee', email: 'invitee@example.com', password: 'a-fine-password', ...extra }),
    }))
    return { status: response.status, body: await response.json() as { code?: string } }
  }

  return { db, signUp }
}

describe('normalizeInviteCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizeInviteCode(' k7qm-2xdp 9hvr-4tnb ')).toBe('K7QM2XDP9HVR4TNB')
  })

  it('turns anything but a string into an empty code', () => {
    expect(normalizeInviteCode(undefined)).toBe('')
    expect(normalizeInviteCode(42)).toBe('')
  })
})

describe('inviteCodeMatches', () => {
  it.each([
    [INVITE_CODE, true],
    ['k7qm2xdp9hvr4tnb', true],
    ['K7QM-2XDP-9HVR-4TNC', false],
    ['K7QM', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('%s → %s', (submitted, expected) => {
    expect(inviteCodeMatches(submitted, INVITE_CODE)).toBe(expected)
  })
})

describe('sign-up with an invite code configured', () => {
  it('rejects a sign-up without a code and creates no user', async () => {
    const { db, signUp } = setup(INVITE_CODE)

    const result = await signUp()

    expect(result.status).toBe(403)
    expect(result.body.code).toBe('INVALID_INVITE_CODE')
    expect(db.select().from(schema.user).all()).toHaveLength(0)
  })

  it('rejects a wrong code', async () => {
    const { db, signUp } = setup(INVITE_CODE)

    const result = await signUp({ inviteCode: 'NOT-THE-CODE' })

    expect(result.status).toBe(403)
    expect(result.body.code).toBe('INVALID_INVITE_CODE')
    expect(db.select().from(schema.user).all()).toHaveLength(0)
  })

  it('creates the user with the right code, typed in lower case', async () => {
    const { db, signUp } = setup(INVITE_CODE)

    const result = await signUp({ inviteCode: INVITE_CODE.toLowerCase() })

    expect(result.status).toBe(200)
    expect(db.select().from(schema.user).all().map(user => user.email)).toEqual(['invitee@example.com'])
  })

  it('lets the same code sign up a second user', async () => {
    const { db, signUp } = setup(INVITE_CODE)

    await signUp({ inviteCode: INVITE_CODE })
    const second = await signUp({ inviteCode: INVITE_CODE, email: 'second@example.com' })

    expect(second.status).toBe(200)
    expect(db.select().from(schema.user).all()).toHaveLength(2)
  })
})

describe('sign-up without an invite code configured', () => {
  it('stays open', async () => {
    const { db, signUp } = setup('')

    const result = await signUp()

    expect(result.status).toBe(200)
    expect(db.select().from(schema.user).all()).toHaveLength(1)
  })
})
