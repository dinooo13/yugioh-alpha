import { stripExpectedErrorStack } from '../utils/dev-error-stack'

// Dev only (#127): nitro's dev error handler source-maps every error's stack with a WASM
// SourceMapConsumer it never frees (nitropack 2.13.4), which ends in "ERROR unreachable".
// Expected 4xx (e.g. a 401 while polling before login) need no stack. 5xx stay mapped.
// The `error` hooks start synchronously in nitro's onError, before its error handler runs.
export default defineNitroPlugin((nitroApp) => {
  if (!import.meta.dev) return
  nitroApp.hooks.hook('error', error => stripExpectedErrorStack(error))
})
