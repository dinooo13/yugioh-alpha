import { describe, expect, it } from 'vitest'
import { createError } from 'h3'
import { stripExpectedErrorStack } from '../../server/utils/dev-error-stack'

// Nitro's dev error handler source-maps every stack frame with a WASM
// consumer it never frees, which ends in "ERROR unreachable" (#127).
describe('stripExpectedErrorStack', () => {
  it('drops the frames of an expected 4xx', () => {
    const error = createError({ statusCode: 401, statusMessage: 'Authentication required' })
    expect(error.stack).toMatch(/\n\s+at /)

    stripExpectedErrorStack(error)

    expect(error.stack).toBe('')
  })

  it('reads `status` when there is no `statusCode`', () => {
    const error = Object.assign(new Error('Not found'), { status: 404 })

    stripExpectedErrorStack(error)

    expect(error.stack).toBe('')
  })

  it('keeps the stack of a 500', () => {
    const error = createError({ statusCode: 500, statusMessage: 'Boom' })
    const stack = error.stack

    stripExpectedErrorStack(error)

    expect(error.stack).toBe(stack)
  })

  it('keeps the stack of an unhandled 4xx', () => {
    const error = Object.assign(createError({ statusCode: 400 }), { unhandled: true })
    const stack = error.stack

    stripExpectedErrorStack(error)

    expect(error.stack).toBe(stack)
  })

  it('keeps the stack of an error without a status', () => {
    const error = new Error('plain')
    const stack = error.stack

    stripExpectedErrorStack(error)

    expect(error.stack).toBe(stack)
  })

  it('ignores values that are not errors', () => {
    expect(() => stripExpectedErrorStack('401')).not.toThrow()
    expect(() => stripExpectedErrorStack(null)).not.toThrow()
    expect(() => stripExpectedErrorStack({ statusCode: 401, stack: 'x' })).not.toThrow()
  })
})
