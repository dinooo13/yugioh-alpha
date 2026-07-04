export interface AuthSession {
  session: unknown
  user: {
    email: string
  }
}

export function getAuthSession(headers?: HeadersInit) {
  return $fetch<AuthSession | null>('/api/auth/get-session', {
    credentials: 'include',
    headers,
  }).catch(() => null)
}

export async function waitForAuthSession() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const session = await getAuthSession()

    if (session) {
      return true
    }

    await new Promise(resolve => setTimeout(resolve, 50))
  }

  return false
}
