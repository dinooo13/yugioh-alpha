// How the chat reads an error that ended a turn (app/utils/assistant-chat-error.ts):
// a bare code from the stream, Nitro's JSON body of an HTTP error, and the
// JSON body with the provider's hint for a model setup problem (#124).

import { describe, expect, it } from 'vitest'
import { assistantChatErrorCode, assistantChatErrorParams } from '~/utils/assistant-chat-error'

const REGION_HINT = 'Upstream request failed: This Go model requires Global regions. Select Global in your workspace\'s Privacy settings to use it.'

describe('assistantChatErrorCode / assistantChatErrorParams', () => {
  it('reads a bare code (the stream\'s error chunk) without params', () => {
    const error = new Error('assistant_unreachable')
    expect(assistantChatErrorCode(error)).toBe('assistant_unreachable')
    expect(assistantChatErrorParams(error)).toBeUndefined()
  })

  it('reads the code and the provider\'s hint of a model setup problem (#124)', () => {
    const error = new Error(JSON.stringify({ data: { code: 'assistant_model_unavailable', params: { hint: REGION_HINT } } }))
    expect(assistantChatErrorCode(error)).toBe('assistant_model_unavailable')
    expect(assistantChatErrorParams(error)).toEqual({ hint: REGION_HINT })
  })

  it('reads the code of an HTTP error\'s JSON body, which has no params', () => {
    const error = new Error(JSON.stringify({ statusCode: 409, statusMessage: 'A turn is already in progress', data: { code: 'turn_in_progress' } }))
    expect(assistantChatErrorCode(error)).toBe('turn_in_progress')
    expect(assistantChatErrorParams(error)).toBeUndefined()
  })

  it.each([
    ['plain text', new Error('Something went wrong.')],
    ['JSON without data', new Error('{"message":"nope"}')],
    ['params that aren\'t a record', new Error(JSON.stringify({ data: { code: 'x', params: ['hint'] } }))],
    ['a non-error', 'assistant_unreachable'],
  ])('finds no params in %s', (_label, error) => {
    expect(assistantChatErrorParams(error)).toBeUndefined()
  })

  it('finds no code in garbage', () => {
    expect(assistantChatErrorCode(new Error('Something went wrong.'))).toBeUndefined()
    expect(assistantChatErrorCode(new Error('{not json'))).toBeUndefined()
    expect(assistantChatErrorCode(null)).toBeUndefined()
  })
})
