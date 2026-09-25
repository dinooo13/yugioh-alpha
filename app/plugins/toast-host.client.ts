import { ensureToastHost } from '~/utils/toast-host'

// Creates the toasts' home before the app mounts, so the toaster's portal
// (client-only, after mount) finds it. See utils/toast-host.ts.
export default defineNuxtPlugin({
  name: 'toast-host',
  setup() {
    ensureToastHost()
  },
})
