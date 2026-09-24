// The error code (ADR 0014, `errors.api.<code>`) of an error that ended a
// chat turn in the AI SDK's chat client: an HTTP error before the stream
// opened carries the server's JSON body as its message (Nitro's
// `{ statusCode, statusMessage, data: { code } }`), and an error during the
// turn is the stream's `error` chunk, whose text is the code itself.

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/

export function assistantChatErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const message = error.message.trim()
  if (CODE_PATTERN.test(message)) {
    return message
  }
  try {
    const body: unknown = JSON.parse(message)
    if (isRecord(body) && isRecord(body.data) && typeof body.data.code === 'string') {
      return body.data.code
    }
  }
  catch {
    // Not a JSON body.
  }
  return undefined
}

/** Whether the request never got an answer (offline, connection dropped) rather than an error from the server. */
export function isAssistantConnectionError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message)
}

/** Whether the server answered with an HTTP error before the turn began (nothing of the turn was stored). */
export function isAssistantHttpError(error: unknown): boolean {
  return isRecord(error) && typeof error.statusCode === 'number'
}
