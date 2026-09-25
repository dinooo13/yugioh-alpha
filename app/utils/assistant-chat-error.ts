// The error code (ADR 0014, `errors.api.<code>`) of an error that ended a
// chat turn in the AI SDK's chat client: an HTTP error before the stream
// opened carries the server's JSON body as its message (Nitro's
// `{ statusCode, statusMessage, data: { code } }`), and an error during the
// turn is the stream's `error` chunk, whose text is the code itself — or,
// for a provider setup problem (#124), the JSON body
// `{ data: { code, params: { hint } } }` with the provider's own message.

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/

/** The `data` of an error message that is a JSON body, else undefined. */
function errorBodyData(error: Error): Record<string, unknown> | undefined {
  try {
    const body: unknown = JSON.parse(error.message.trim())
    return isRecord(body) && isRecord(body.data) ? body.data : undefined
  }
  catch {
    // Not a JSON body.
    return undefined
  }
}

export function assistantChatErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const message = error.message.trim()
  if (CODE_PATTERN.test(message)) {
    return message
  }
  const data = errorBodyData(error)
  return typeof data?.code === 'string' ? data.code : undefined
}

/** The named params of an error's JSON body (`data.params`, e.g. the provider's `hint`, #124), else undefined. */
export function assistantChatErrorParams(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const params = errorBodyData(error)?.params
  return isRecord(params) ? params : undefined
}

/** Whether the request never got an answer (offline, connection dropped) rather than an error from the server. */
export function isAssistantConnectionError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message)
}

/** Whether the server answered with an HTTP error before the turn began (nothing of the turn was stored). */
export function isAssistantHttpError(error: unknown): boolean {
  return isRecord(error) && typeof error.statusCode === 'number'
}
