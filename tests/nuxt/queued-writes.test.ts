import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useQueuedWrites } from '~/composables/useQueuedWrites'

// The write queue of the deck editor, the wishlist rows and the inventory
// editor (#148): one write after another, last write wins.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useQueuedWrites', () => {
  it('starts a task only once the one before it has settled', async () => {
    const { enqueue } = useQueuedWrites()
    const first = deferred<string>()
    const started: string[] = []

    enqueue(() => {
      started.push('first')
      return first.promise
    })
    enqueue(async () => {
      started.push('second')
    })
    await flushPromises()
    expect(started).toEqual(['first'])

    first.resolve('done')
    await flushPromises()
    expect(started).toEqual(['first', 'second'])
  })

  it('runs the tasks in call order and answers each call with its own value', async () => {
    const { enqueue } = useQueuedWrites()
    const order: number[] = []
    const results = await Promise.all([1, 2, 3].map(n => enqueue(async () => {
      order.push(n)
      return n * 10
    })))

    expect(order).toEqual([1, 2, 3])
    expect(results.map(result => result.ok && result.value)).toEqual([10, 20, 30])
  })

  it('marks only the last queued task as latest', async () => {
    const { enqueue } = useQueuedWrites()
    const first = enqueue(async () => 'a')
    const second = enqueue(async () => 'b')

    expect(await first).toEqual({ ok: true, value: 'a', latest: false })
    expect(await second).toEqual({ ok: true, value: 'b', latest: true })

    // A write after the queue drained is the latest again.
    expect(await enqueue(async () => 'c')).toEqual({ ok: true, value: 'c', latest: true })
  })

  it('reports a rejected task without blocking the next one', async () => {
    const { enqueue } = useQueuedWrites()
    const error = new Error('offline')
    const failed = enqueue(() => Promise.reject(error))
    const next = enqueue(async () => 'after')

    expect(await failed).toEqual({ ok: false, error, latest: false })
    expect(await next).toEqual({ ok: true, value: 'after', latest: true })
  })

  it('counts the pending writes up and down', async () => {
    const { enqueue, pending } = useQueuedWrites()
    const first = deferred<undefined>()
    expect(pending.value).toBe(0)

    const a = enqueue(() => first.promise)
    const b = enqueue(async () => {})
    expect(pending.value).toBe(2)

    first.resolve(undefined)
    await a
    expect(pending.value).toBe(1)
    await b
    expect(pending.value).toBe(0)
  })

  it('keeps separate queues apart', async () => {
    const one = useQueuedWrites()
    const two = useQueuedWrites()
    const blocked = deferred<undefined>()
    one.enqueue(() => blocked.promise)

    // The other queue doesn't wait for the first one's pending write.
    expect(await two.enqueue(async () => 'free')).toEqual({ ok: true, value: 'free', latest: true })
    blocked.resolve(undefined)
  })
})
