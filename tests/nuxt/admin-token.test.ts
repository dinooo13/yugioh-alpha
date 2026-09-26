// The /api/admin/** gate (ADR 0027): a bearer token, not a session.
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { bearerToken, requireAdminToken } from '../../server/utils/admin-token'

const TOKEN = 'admin-token-for-tests-0123456789'

function eventWith(authorization?: string) {
  const req = new IncomingMessage(new Socket())
  req.method = 'POST'
  req.url = '/api/admin/catalog/sync'
  if (authorization !== undefined) {
    req.headers.authorization = authorization
  }
  return createEvent(req, new ServerResponse(req))
}

function statusOf(run: () => void): number | null {
  try {
    run()
    return null
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1
  }
}

describe('bearerToken', () => {
  it.each([
    [`Bearer ${TOKEN}`, TOKEN],
    [`bearer ${TOKEN}`, TOKEN],
    [`Basic ${TOKEN}`, null],
    ['Bearer', null],
    ['', null],
    [undefined, null],
  ])('%s → %s', (header, expected) => {
    expect(bearerToken(header)).toBe(expected)
  })
})

describe('requireAdminToken', () => {
  it('lets the right token through', () => {
    expect(statusOf(() => requireAdminToken(eventWith(`Bearer ${TOKEN}`), TOKEN))).toBeNull()
  })

  it('answers 401 without a token or with a wrong one', () => {
    expect(statusOf(() => requireAdminToken(eventWith(), TOKEN))).toBe(401)
    expect(statusOf(() => requireAdminToken(eventWith('Bearer wrong-token'), TOKEN))).toBe(401)
    expect(statusOf(() => requireAdminToken(eventWith(TOKEN), TOKEN))).toBe(401)
  })

  it('answers 403 for everyone when no token is configured', () => {
    expect(statusOf(() => requireAdminToken(eventWith(`Bearer ${TOKEN}`), ''))).toBe(403)
    expect(statusOf(() => requireAdminToken(eventWith(), ''))).toBe(403)
  })
})
