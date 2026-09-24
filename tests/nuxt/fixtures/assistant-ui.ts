// Fixtures for the assistant's client tests (AI SDK chat client,
// docs/adr/0020-assistant-on-the-ai-sdk.md): conversations as
// `GET /api/assistant/chat/:id/messages` returns them, and turns as
// `POST …/stream` streams them (the UI message stream protocol: one SSE
// `data:` line per chunk).

import type { AssistantActionView, AssistantConversationSummary } from '~~/shared/assistant-chat'
import type { AssistantUIMessage } from '~~/shared/assistant-ui'

export function conversationSummary(overrides: Partial<AssistantConversationSummary> = {}): AssistantConversationSummary {
  return {
    id: 'conv-1',
    title: 'Testkonversation',
    deck: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:05:00.000Z',
    ...overrides,
  }
}

export function pendingAction(overrides: Partial<AssistantActionView> = {}): AssistantActionView {
  return {
    id: 'action-1',
    messageId: 'm2',
    kind: 'add_to_inventory',
    summary: '1 Karte(n) zum Inventar hinzufügen: Dark Magician x2',
    payload: { items: [{ catalogCardId: 46986414, name: 'Dark Magician', quantity: 2 }] },
    status: 'pending',
    ...overrides,
  }
}

/** A search, its chip, a proposal and the answer — the shape a stored turn has. */
export function searchConversation(): AssistantUIMessage[] {
  return [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'suche Dark Magician' }] },
    {
      id: 'm2',
      role: 'assistant',
      metadata: { model: 'mimo-v2.6-pro' },
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-search_catalog',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { query: 'Dark Magician' },
          output: { result: [{ id: 46986414, name: 'Dark Magician' }] },
        },
        { type: 'tool-add_to_inventory', toolCallId: 'call-2', state: 'output-available', input: { items: [] }, output: { result: { status: 'pending_confirmation' } } },
        { type: 'data-action', id: 'action-1', data: pendingAction() },
        { type: 'step-start' },
        { type: 'text', text: 'Ich habe 1 Karte gefunden: Dark Magician.', state: 'done' },
      ],
    },
  ]
}

/** A Response streaming the given UI message chunks, all at once. */
export function uiStreamResponse(chunks: unknown[]): Response {
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } })
}

/** A Response whose chunks are pushed by the test, one at a time. */
export function controlledUiStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } }),
    push: (chunk: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    close: () => {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

/** The chunks of a plain text answer. */
export function textAnswer(id: string, text: string, metadata: Record<string, unknown> = {}): unknown[] {
  return [
    { type: 'start', messageId: id, messageMetadata: metadata },
    { type: 'start-step' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ]
}

/** An HTTP error as Nitro sends it (`createError` with `data.code`). */
export function httpErrorResponse(statusCode: number, code: string): Response {
  return new Response(JSON.stringify({ statusCode, statusMessage: 'Error', data: { code } }), { status: statusCode, headers: { 'content-type': 'application/json' } })
}

/** The JSON body the chat client posted (the last `fetch` call's by default). */
export function postedBody(fetchMock: { mock: { calls: unknown[][] } }, index = -1): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(index)!
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>
}
