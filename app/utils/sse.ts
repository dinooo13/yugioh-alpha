// A minimal `text/event-stream` reader for POST requests (Phase 8 chat
// assistant, see docs/adr/0010-chat-assistant-with-tools.md). The browser's
// built-in `EventSource` only ever issues GET requests, so
// `POST /api/assistant/chat/:id/messages` is read by hand: `fetch` gives us
// a `ReadableStream<Uint8Array>` body, which we decode and split into
// events ourselves.
//
// Tolerant of events (and even the blank-line separator between them) being
// split arbitrarily across chunks — network reads have no relationship to
// event boundaries — by accumulating everything into a string buffer and
// only consuming complete events out of it.

export interface SseEvent<T = unknown> {
  event: string
  data: T
}

/** Same shape as the body Nitro's `createError` serializes, so callers can
 * reuse `apiErrorMessage` (app/utils/card-entry.ts) against it. */
export class SseRequestError extends Error {
  statusCode: number
  data?: unknown

  constructor(statusCode: number, message: string, data?: unknown) {
    super(message)
    this.name = 'SseRequestError'
    this.statusCode = statusCode
    this.data = data
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Parses one event block (everything between two blank-line separators)
 * into `{ event, data }`. Comment lines (`:`) and unrecognized fields
 * (`id:`, `retry:`) are ignored; unlike the SSE spec, a missing `event:`
 * line falls back to `'message'` rather than being dropped. */
function parseEventBlock(block: string): SseEvent<string> | null {
  let event = 'message'
  const dataLines: string[] = []
  let sawField = false

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine === '' || rawLine.startsWith(':')) {
      continue
    }
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice('event:'.length).trim()
      sawField = true
    }
    else if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice('data:'.length).replace(/^ /, ''))
      sawField = true
    }
  }

  if (!sawField) {
    return null
  }
  return { event, data: dataLines.join('\n') }
}

/** Pulls every complete event out of `buffer`, returning the parsed events
 * plus whatever incomplete tail is left (to be prefixed onto the next
 * chunk). A blank line (`\n\n`, `\r\n\r\n`, or a mix) ends an event. */
function drainCompleteEvents(buffer: string): { events: SseEvent<string>[], rest: string } {
  const events: SseEvent<string>[] = []
  let rest = buffer
  const separator = /\r?\n\r?\n/

  let match = separator.exec(rest)
  while (match) {
    const block = rest.slice(0, match.index)
    rest = rest.slice(match.index + match[0].length)
    const parsed = parseEventBlock(block)
    if (parsed) {
      events.push(parsed)
    }
    match = separator.exec(rest)
  }

  return { events, rest }
}

function parseData(raw: string): unknown {
  if (raw === '') {
    return undefined
  }
  try {
    return JSON.parse(raw)
  }
  catch {
    return raw
  }
}

async function toRequestError(response: Response): Promise<SseRequestError> {
  let body: unknown
  try {
    body = await response.json()
  }
  catch {
    body = undefined
  }
  const statusMessage = isRecord(body) && typeof body.statusMessage === 'string' ? body.statusMessage : undefined
  return new SseRequestError(response.status, statusMessage ?? `Anfrage fehlgeschlagen (${response.status}).`, body)
}

/**
 * POSTs to `input` and yields every SSE event from the response body as it
 * arrives, with `data` JSON-parsed (falling back to the raw string when it
 * isn't valid JSON — none of this API's events use that, but a reader
 * shouldn't throw over it). Pass `init.signal` to support cancellation
 * ("Abbrechen" in the composer aborts the underlying fetch).
 */
export async function* readSse(input: string, init: RequestInit = {}): AsyncGenerator<SseEvent, void, unknown> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw await toRequestError(response)
  }
  if (!response.body) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = drainCompleteEvents(buffer)
        buffer = rest
        for (const event of events) {
          yield { event: event.event, data: parseData(event.data) }
        }
      }

      if (done) {
        buffer += decoder.decode()
        const trailing = parseEventBlock(buffer)
        if (trailing) {
          yield { event: trailing.event, data: parseData(trailing.data) }
        }
        return
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}
