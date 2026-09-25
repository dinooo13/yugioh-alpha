/**
 * A write queue for controls that save at once (steppers, selects, notes):
 * the deck editor, the wishlist rows and the inventory editor (#135, #148).
 *
 * - Writes run strictly one after another, in call order: a task starts only
 *   once the one before it has settled. So a quick "+ + +" that sends
 *   absolute quantities (2, 3, 4) reaches the server in that order.
 * - A failed write doesn't block the next one; its error comes back in the
 *   result (`ok: false`), `enqueue` itself never rejects.
 * - `latest` tells the caller whether any write was queued after this one
 *   while it ran. Only the last answer should be rendered (last write wins);
 *   an earlier answer is already outdated by the write behind it.
 * - Callers keep their controls enabled while writes are pending and show
 *   the wanted value at once (optimistically). Disabling a focused button
 *   would drop keyboard focus to the page.
 */
export type QueuedWriteResult<T> =
  | { ok: true, value: T, latest: boolean }
  | { ok: false, error: unknown, latest: boolean }

export function useQueuedWrites() {
  let chain: Promise<unknown> = Promise.resolve()
  let sequence = 0
  const pending = ref(0)

  function enqueue<T>(task: () => Promise<T>): Promise<QueuedWriteResult<T>> {
    const token = ++sequence
    pending.value += 1
    const run = chain
      .then(task)
      .then(
        value => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .then((result): QueuedWriteResult<T> => {
        pending.value -= 1
        return { ...result, latest: token === sequence }
      })
    // `run` never rejects, so one failed write can't stall the queue.
    chain = run
    return run
  }

  return { enqueue, pending: readonly(pending) }
}
