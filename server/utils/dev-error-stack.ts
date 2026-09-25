/**
 * Empties the stack of an expected client error (a handled 4xx such as the
 * 401 of an endpoint polled before login), so nitro's dev error handler finds
 * no frames to source-map (#127, see server/plugins/dev-error-stack.ts). An
 * empty string, not `name: message`: youch-core parses that one line as an
 * "app" frame and still calls the source loader for it. Server errors (5xx)
 * and unhandled errors keep their stack.
 */
export function stripExpectedErrorStack(error: unknown): void {
  if (!(error instanceof Error)) return
  const { statusCode, status, unhandled } = error as Error & { statusCode?: unknown, status?: unknown, unhandled?: unknown }
  const code = typeof statusCode === 'number' ? statusCode : typeof status === 'number' ? status : undefined
  if (code === undefined || code >= 500 || unhandled === true) return
  error.stack = ''
}
