import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_HISTORY_CHAR_LIMIT,
  DEFAULT_ASSISTANT_HISTORY_MESSAGE_LIMIT,
  DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS,
  DEFAULT_ASSISTANT_TIMEOUT_MS,
  DEFAULT_ASSISTANT_TOOL_RESULT_MAX_CHARS,
  DEFAULT_ASSISTANT_TOOL_RESULT_MAX_ITEMS,
  getAssistantLimits,
} from '../../server/utils/assistant-limits'

// `runtimeConfig.assistant.limits` (see nuxt.config.ts) is a plain object
// vitest-environment-nuxt hands back the same reference for every
// `useRuntimeConfig()` call within a test file — mutating it in place and
// restoring it afterwards is the same pattern assistant-model.test.ts uses
// for `useRuntimeConfig().assistant`.
function withLimitsConfig(overrides: Record<string, unknown>, run: () => void) {
  const config = useRuntimeConfig().assistant as { limits: Record<string, unknown> }
  const original = { ...config.limits }
  try {
    Object.assign(config.limits, overrides)
    run()
  }
  finally {
    config.limits = original
  }
}

describe('getAssistantLimits', () => {
  it('returns the documented defaults when runtimeConfig carries them unchanged', () => {
    expect(getAssistantLimits()).toEqual({
      maxToolRounds: DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS,
      toolResultItems: DEFAULT_ASSISTANT_TOOL_RESULT_MAX_ITEMS,
      toolResultChars: DEFAULT_ASSISTANT_TOOL_RESULT_MAX_CHARS,
      historyMessages: DEFAULT_ASSISTANT_HISTORY_MESSAGE_LIMIT,
      historyChars: DEFAULT_ASSISTANT_HISTORY_CHAR_LIMIT,
      timeoutMs: DEFAULT_ASSISTANT_TIMEOUT_MS,
    })
  })

  it('accepts a numeric string override — Nitro passes an env var through destr, but a string is handled too', () => {
    withLimitsConfig({ maxToolRounds: '5', timeoutMs: '45000' }, () => {
      const limits = getAssistantLimits()
      expect(limits.maxToolRounds).toBe(5)
      expect(limits.timeoutMs).toBe(45_000)
    })
  })

  it('falls back to the default for a garbage override — non-numeric, zero, negative, or non-integer', () => {
    withLimitsConfig({
      maxToolRounds: 'not-a-number',
      toolResultItems: 0,
      toolResultChars: -10,
      historyMessages: 12.5,
      historyChars: null,
      timeoutMs: Number.NaN,
    }, () => {
      expect(getAssistantLimits()).toEqual({
        maxToolRounds: DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS,
        toolResultItems: DEFAULT_ASSISTANT_TOOL_RESULT_MAX_ITEMS,
        toolResultChars: DEFAULT_ASSISTANT_TOOL_RESULT_MAX_CHARS,
        historyMessages: DEFAULT_ASSISTANT_HISTORY_MESSAGE_LIMIT,
        historyChars: DEFAULT_ASSISTANT_HISTORY_CHAR_LIMIT,
        timeoutMs: DEFAULT_ASSISTANT_TIMEOUT_MS,
      })
    })
  })

  it('clamps an absurdly large override to the upper bound instead of trusting it outright', () => {
    withLimitsConfig({ maxToolRounds: 1_000_000 }, () => {
      const limits = getAssistantLimits()
      expect(limits.maxToolRounds).toBeLessThan(1_000_000)
      expect(limits.maxToolRounds).toBeGreaterThan(DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS)
    })
  })
})
