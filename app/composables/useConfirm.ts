export interface ConfirmOptions {
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void
}

/**
 * Single shared request slot — `ConfirmDialog.vue` (mounted once in
 * `default.vue`) renders whatever is in here as a `UModal`. Using a `useState`
 * key rather than a module-level ref keeps this SSR-safe (a fresh value per
 * request) while still being a true singleton on the client.
 */
function confirmState() {
  return useState<ConfirmRequest | null>('confirm-dialog-request', () => null)
}

/**
 * Promise-based replacement for `window.confirm` (UX review #14): themed,
 * mobile-friendly, and consistent with the rest of the app instead of a
 * native browser dialog. Resolves `true`/`false` once the user picks an
 * option; if a second confirm is requested while one is already open, the
 * first is auto-dismissed with `false` rather than left dangling.
 */
export function useConfirm() {
  const request = confirmState()

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      request.value?.resolve(false)
      request.value = { ...options, resolve }
    })
  }

  return { confirm }
}

/** Internal — consumed by `ConfirmDialog.vue` only. */
export function useConfirmDialogState() {
  return confirmState()
}
