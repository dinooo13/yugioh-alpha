import { afterEach, describe, expect, it, vi } from 'vitest'
import { SseRequestError, readSse } from '~/utils/sse'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function collect<T>(iterable: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) {
    items.push(item)
  }
  return items
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readSse', () => {
  it('parses whole events delivered in a single chunk', async () => {
    const body = streamFromChunks([
      'event: message_start\ndata: {"userMessageId":"m1"}\n\n'
      + 'event: text_delta\ndata: {"text":"Hallo"}\n\n',
    ])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/api/assistant/chat/1/messages', { method: 'POST' }))

    expect(events).toEqual([
      { event: 'message_start', data: { userMessageId: 'm1' } },
      { event: 'text_delta', data: { text: 'Hallo' } },
    ])
  })

  it('reassembles an event split across many chunks, mid-line and mid-separator', async () => {
    const body = streamFromChunks([
      'event: text_del',
      'ta\ndata: {"tex',
      't":"Da',
      'rk Magician"}',
      '\n',
      '\n',
      'event: message_end\ndata: {"message":{"id":"a1","role":"assistant","content":"Fertig","createdAt":"now"}}\n\n',
    ])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/x'))

    expect(events).toEqual([
      { event: 'text_delta', data: { text: 'Dark Magician' } },
      { event: 'message_end', data: { message: { id: 'a1', role: 'assistant', content: 'Fertig', createdAt: 'now' } } },
    ])
  })

  it('flushes a final event that has no trailing blank line', async () => {
    const body = streamFromChunks(['event: error\ndata: {"message":"kaputt"}'])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/x'))

    expect(events).toEqual([{ event: 'error', data: { message: 'kaputt' } }])
  })

  it('defaults the event name to "message" when only data is sent', async () => {
    const body = streamFromChunks(['data: {"text":"ohne Namen"}\n\n'])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/x'))

    expect(events).toEqual([{ event: 'message', data: { text: 'ohne Namen' } }])
  })

  it('falls back to the raw string when the payload is not valid JSON', async () => {
    const body = streamFromChunks(['event: text_delta\ndata: not json\n\n'])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/x'))

    expect(events).toEqual([{ event: 'text_delta', data: 'not json' }])
  })

  it('ignores comment lines', async () => {
    const body = streamFromChunks([': keep-alive\nevent: text_delta\ndata: {"text":"x"}\n\n'])
    stubFetch(new Response(body, { status: 200 }))

    const events = await collect(readSse('/x'))

    expect(events).toEqual([{ event: 'text_delta', data: { text: 'x' } }])
  })

  it('throws a request error carrying the response status, body and error code for a non-ok response', async () => {
    const body = { statusCode: 409, statusMessage: 'A turn is already in progress', data: { code: 'turn_in_progress' } }
    stubFetch(new Response(JSON.stringify(body), { status: 409 }))

    await expect(collect(readSse('/x'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'turn_in_progress',
      message: 'A turn is already in progress',
      data: body,
    })
  })

  it('falls back to a generic message when the error body has no statusMessage', async () => {
    stubFetch(new Response('not json', { status: 503 }))

    let caught: unknown
    try {
      await collect(readSse('/x'))
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(SseRequestError)
    expect((caught as SseRequestError).statusCode).toBe(503)
  })

  it('yields nothing for a response without a body', async () => {
    const response = new Response(null, { status: 204 })
    stubFetch(response)

    expect(await collect(readSse('/x'))).toEqual([])
  })
})
