import { createUnauthorizedHandler, isProtectedApiRequest } from '~/utils/api-unauthorized'
import { getAuthSession } from '~/utils/session'

/**
 * Sends the user to `/login?redirect=<page>` when one of the app's API calls
 * answers 401 on a protected page (#148). The auth middleware checks the
 * session only when the path changes, so a session that ends while the user
 * stays on one page (filters, `?card=` overlays) is noticed here, by the
 * page's next API call.
 *
 * Every `$fetch` and `useFetch` on the client goes through `globalThis.$fetch`
 * at call time, so a default `onResponseError` hook covers them all; a call
 * that passes its own `onResponseError` replaces this default (none does).
 */
export default defineNuxtPlugin({
  name: 'api-unauthorized',
  setup(nuxtApp) {
    const router = useRouter()
    const onUnauthorized = createUnauthorizedHandler({
      currentRoute: () => router.currentRoute.value,
      hasSession: async () => Boolean(await getAuthSession()),
      redirect: target => nuxtApp.runWithContext(() => navigateTo(target)),
    })

    globalThis.$fetch = globalThis.$fetch.create({
      onResponseError({ request, response }) {
        if (response.status === 401 && isProtectedApiRequest(request, window.location.origin)) {
          // Not awaited: the caller gets its error at once and shows its own state meanwhile.
          void onUnauthorized()
        }
      },
    }) as typeof globalThis.$fetch
  },
})
