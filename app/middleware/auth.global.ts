import { authClient } from '~/utils/auth-client'

const PUBLIC_PAGES = new Set(['/login', '/register'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PAGES.has(to.path)) {
    return
  }

  const { data: session } = await authClient.useSession(useFetch)

  if (!session.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
