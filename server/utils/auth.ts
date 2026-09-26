import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { useDb } from '../db'
import * as schema from '../db/schema'
import { inviteCodeGate } from './invite-code'

export interface CreateAuthOptions {
  db: BetterSQLite3Database<typeof schema>
  secret: string
  baseURL: string
  /** Shared sign-up invite code (ADR 0027); '' = open sign-up. */
  inviteCode: string
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema,
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    emailAndPassword: {
      enabled: true,
    },
    hooks: {
      before: inviteCodeGate(options.inviteCode),
    },
  })
}

let authInstance: ReturnType<typeof createAuth> | undefined

/**
 * Singleton Better Auth instance, configured for email/password auth
 * over the SQLite/Drizzle database.
 */
export function useAuth() {
  if (!authInstance) {
    const config = useRuntimeConfig()
    authInstance = createAuth({
      db: useDb(),
      secret: config.betterAuthSecret,
      baseURL: config.public.betterAuthUrl,
      inviteCode: config.inviteCode,
    })
  }
  return authInstance
}
