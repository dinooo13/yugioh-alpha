import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { useDb } from '../db'
import * as schema from '../db/schema'

function createAuth() {
  const config = useRuntimeConfig()

  return betterAuth({
    database: drizzleAdapter(useDb(), {
      provider: 'sqlite',
      schema,
    }),
    secret: config.betterAuthSecret,
    baseURL: config.public.betterAuthUrl,
    emailAndPassword: {
      enabled: true,
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
    authInstance = createAuth()
  }
  return authInstance
}
