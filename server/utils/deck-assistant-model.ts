// The chat assistant's model abstraction (docs/adr/0010-chat-assistant-with-tools.md):
// a small interface the chat engine (server/utils/assistant-chat.ts) drives,
// plus two implementations — a real model reached over any OpenAI-compatible
// Chat Completions endpoint, and a deterministic, network-free "fake" used in
// tests and E2E. (The one-shot structured-output `generate()` of the former
// AI deck assistant is gone — deck assistance lives in the chat now, see
// docs/adr/0011-deck-assistance-in-chat.md.)
//
// The server never trusts what a model returns: tool-call arguments are raw
// JSON strings, validated by the tool layer (server/utils/assistant-tools.ts).

import { createError } from 'h3'
import { DEFAULT_ASSISTANT_TIMEOUT_MS, getAssistantLimits } from './assistant-limits'
import {
  ASSISTANT_USER_AGENT,
  FAKE_MODEL_ID,
  resolveApiKey,
  resolveBaseUrl,
  resolveModelId,
  resolveProvider,
  resolveReasoningEffort,
  resolveVisionModel,
  useAssistantRuntimeConfig,
} from './assistant-model'

// --- Chat (tool-calling, streamed) --------------------------------------------
//
// A multi-turn conversation with text + image input and OpenAI-style tool
// calling, streamed over SSE — always the Chat Completions endpoint with
// `stream: true`; see server/utils/assistant-chat.ts for the loop that
// drives it.

export interface ChatTextPart { type: 'text', text: string }
export interface ChatImagePart { type: 'image_url', image_url: { url: string } }
export type ChatUserContentPart = ChatTextPart | ChatImagePart

export interface ChatAssistantToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export type ChatMessage =
  | { role: 'user', content: ChatUserContentPart[] }
  | { role: 'assistant', content: string | null, tool_calls?: ChatAssistantToolCall[] }
  | { role: 'tool', tool_call_id: string, content: string }

export interface ToolDefinition {
  type: 'function'
  function: { name: string, description: string, parameters: Record<string, unknown> }
}

export interface ChatModelInput {
  /** Stable id sent as `x-opencode-session` — the conversation id. */
  sessionId: string
  /** Overrides the configured model for this call (vision-capable model for turns with images). */
  model?: string
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
}

export interface ChatStreamHandlers {
  onTextDelta: (text: string) => void
  onToolCallDelta?: () => void
}

export interface ChatModelToolCall {
  id: string
  name: string
  /** Raw JSON string, exactly as accumulated from the stream — parsed (and validated) by the caller. */
  arguments: string
}

export interface ChatModelResult {
  text: string
  toolCalls: ChatModelToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other'
  /** Set when `signal` aborted the call mid-stream (a user "Abbrechen") —
   * `text`/`toolCalls` carry whatever was accumulated before the abort, so
   * the caller can still persist a partial answer instead of losing it. */
  aborted?: boolean
}

export interface DeckAssistantModel {
  readonly id: string
  /**
   * Multi-turn chat with tool calling, streamed. `signal`, when given, aborts
   * the underlying request/stream read early (combined with the model's own
   * request timeout) — see `runChatTurn` (assistant-chat.ts) for how the
   * turn loop reacts to `result.aborted`.
   */
  chat(input: ChatModelInput, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<ChatModelResult>
}

/** Technical English `statusMessage` plus the `data.code` the UI translates (ADR 0014, `errors.api.<code>`). */
function assistantError(statusCode: number, code: 'assistant_misconfigured' | 'assistant_busy' | 'assistant_unreachable'): never {
  const message = ASSISTANT_ERROR_MESSAGES[code]
  throw createError({ statusCode, statusMessage: message, message, data: { code } })
}

const ASSISTANT_ERROR_MESSAGES = {
  assistant_misconfigured: 'The assistant is not configured correctly',
  assistant_busy: 'The assistant is busy, try again later',
  assistant_unreachable: 'The assistant is currently unreachable',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// --- Shared request plumbing (headers) ----------------------------------------
//
// OpenCode Go rejects any request that lacks
// `x-opencode-session`; other providers ignore it. `User-Agent` identifies
// the app/version to whichever gateway is on the other end.

function buildRequestHeaders(apiKey: string, sessionId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-opencode-session': sessionId,
    'user-agent': ASSISTANT_USER_AGENT,
    ...(apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
  }
}

// --- OpenAI-compatible model --------------------------------------------------
//
// Talks to any Chat Completions endpoint that follows the OpenAI schema —
// OpenAI itself, OpenRouter, Ollama, LM Studio, OpenCode Zen, etc. — over
// plain `fetch` (streamed SSE), with a configurable timeout (default 300s,
// see `DEFAULT_ASSISTANT_TIMEOUT_MS` / `getAssistantLimits().timeoutMs`).

export interface CreateOpenAiCompatibleModelOptions {
  baseUrl: string
  apiKey?: string
  model: string
  /**
   * Sent as `reasoning_effort` when set. Some OpenAI-compatible gateways
   * (e.g. OpenCode Go) require it for certain models; most ignore it.
   */
  reasoningEffort?: string
  /**
   * Used instead of `model` for a chat turn that contains an image, when set
   * (`NUXT_ASSISTANT_VISION_MODEL` / `runtimeConfig.assistant.visionModel`).
   */
  visionModel?: string
  /**
   * Per-request timeout, in milliseconds, for `chat()`
   * (`NUXT_ASSISTANT_LIMITS_TIMEOUT_MS` /
   * `getAssistantLimits().timeoutMs`). Defaults to
   * `DEFAULT_ASSISTANT_TIMEOUT_MS` when omitted, e.g. for tests that
   * construct a model directly.
   */
  timeoutMs?: number
  /** Injectable for tests. */
  fetch?: typeof fetch
}

/** Maps the provider status codes with a dedicated error code (auth, rate limit); returns for anything else. */
function mapCommonErrorStatus(status: number): void {
  if (status === 401 || status === 403) {
    assistantError(503, 'assistant_misconfigured')
  }
  if (status === 429) {
    assistantError(503, 'assistant_busy')
  }
}

function mapFinishReason(raw: unknown): ChatModelResult['finishReason'] {
  return raw === 'stop' || raw === 'length' || raw === 'tool_calls' || raw === 'content_filter' ? raw : 'other'
}

/**
 * Reads a `text/event-stream` body, tolerating `data:` lines split across
 * chunk boundaries and a final `data: [DONE]`. Per the SSE spec, one event
 * may carry several `data:` lines that must be joined with `\n` before
 * parsing (a provider that pretty-prints or chunks its JSON that way would
 * otherwise silently lose every delta) — lines are buffered per event and
 * only parsed once the blank-line separator (or end of stream) is reached.
 * Calls `onData` with the parsed JSON of every well-formed event (a
 * malformed one is skipped).
 */
async function readSseEvents(
  body: ReadableStream<Uint8Array> | null,
  onData: (json: unknown) => void,
): Promise<void> {
  if (!body) {
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let pendingDataLines: string[] = []

  const flush = () => {
    if (pendingDataLines.length === 0) {
      return
    }
    const data = pendingDataLines.join('\n')
    pendingDataLines = []
    if (data === '' || data === '[DONE]') {
      return
    }
    try {
      onData(JSON.parse(data))
    }
    catch {
      // Malformed event — ignore and keep reading the stream.
    }
  }

  const consumeLine = (line: string) => {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed === '') {
      // Blank line: the SSE event boundary — flush whatever `data:` lines
      // accumulated since the last one.
      flush()
      return
    }
    if (!trimmed.startsWith('data:')) {
      return
    }
    pendingDataLines.push(trimmed.slice(5).replace(/^ /, ''))
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      consumeLine(line)
    }
  }

  if (buffer !== '') {
    consumeLine(buffer)
  }
  // The stream may end right after the last event's `data:` line(s), with no
  // trailing blank line to trigger the flush above.
  flush()
}

export function createOpenAiCompatibleModel(options: CreateOpenAiCompatibleModelOptions): DeckAssistantModel {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const apiKey = options.apiKey ?? ''
  const model = options.model
  const reasoningEffort = (options.reasoningEffort ?? '').trim()
  const visionModel = (options.visionModel ?? '').trim()
  const timeoutMs = options.timeoutMs ?? DEFAULT_ASSISTANT_TIMEOUT_MS
  const fetchImpl = options.fetch ?? fetch

  return {
    id: model,
    async chat(input: ChatModelInput, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<ChatModelResult> {
      const hasImage = input.messages.some(message =>
        message.role === 'user' && message.content.some(part => part.type === 'image_url'))
      const modelToUse = input.model?.trim() || (hasImage && visionModel ? visionModel : model)

      const body: Record<string, unknown> = {
        model: modelToUse,
        messages: [{ role: 'system', content: input.system }, ...input.messages],
        stream: true,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' } : {}),
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      // Combine our own request timeout with the caller's cancellation
      // signal (the turn's "Abbrechen") — either one aborts the same
      // in-flight fetch/stream read; `signal?.aborted` below is what tells
      // the two apart afterwards.
      const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal

      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { ...buildRequestHeaders(apiKey, input.sessionId), accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: combinedSignal,
        })
      }
      catch (error) {
        clearTimeout(timeoutId)
        if (signal?.aborted) {
          return { text: '', toolCalls: [], finishReason: 'other', aborted: true }
        }
        if (error instanceof Error && error.name === 'AbortError') {
          assistantError(502, 'assistant_unreachable')
        }
        assistantError(502, 'assistant_unreachable')
      }

      if (response.status < 200 || response.status >= 300) {
        clearTimeout(timeoutId)
        mapCommonErrorStatus(response.status)
        assistantError(502, 'assistant_unreachable')
      }

      let text = ''
      let finishReason: ChatModelResult['finishReason'] = 'other'
      const toolCallsByIndex = new Map<number, ChatModelToolCall>()

      try {
        await readSseEvents(response.body, (json) => {
          if (!isRecord(json)) {
            return
          }
          const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
          if (!isRecord(choice)) {
            return
          }

          const delta = choice.delta
          if (isRecord(delta)) {
            if (typeof delta.content === 'string' && delta.content !== '') {
              text += delta.content
              handlers.onTextDelta(delta.content)
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const rawCall of delta.tool_calls) {
                if (!isRecord(rawCall) || typeof rawCall.index !== 'number') {
                  continue
                }
                const existing = toolCallsByIndex.get(rawCall.index) ?? { id: '', name: '', arguments: '' }
                if (typeof rawCall.id === 'string' && rawCall.id !== '') {
                  existing.id = rawCall.id
                }
                const fn = rawCall.function
                if (isRecord(fn)) {
                  if (typeof fn.name === 'string' && fn.name !== '') {
                    existing.name = fn.name
                  }
                  if (typeof fn.arguments === 'string') {
                    existing.arguments += fn.arguments
                  }
                }
                toolCallsByIndex.set(rawCall.index, existing)
                handlers.onToolCallDelta?.()
              }
            }
          }

          if (typeof choice.finish_reason === 'string') {
            finishReason = mapFinishReason(choice.finish_reason)
          }
        })
      }
      catch {
        clearTimeout(timeoutId)
        // A mid-stream abort/dropped connection rejects `reader.read()` with
        // a raw AbortError/TypeError. When the caller's own signal is what
        // aborted it (an explicit "Abbrechen", not our request timeout),
        // report it as such with whatever text/tool-calls were accumulated
        // so far — the turn loop persists that as a partial answer — rather
        // than mapping it to the same "unreachable" 502 as a real failure.
        if (signal?.aborted) {
          const toolCalls = [...toolCallsByIndex.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
          return { text, toolCalls, finishReason: 'other', aborted: true }
        }
        assistantError(502, 'assistant_unreachable')
      }
      finally {
        clearTimeout(timeoutId)
      }

      const toolCalls = [...toolCallsByIndex.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)

      return { text, toolCalls, finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason }
    },
  }
}

// --- Fake model (deterministic, no network) ----------------------------------

// --- Fake chat (deterministic, scripted tool-calling for tests/E2E) ----------
//
// Drives a small, fixed script off the *last* user message's text/image, and
// whether a tool has already run earlier in the same turn (a 'tool' message
// after that last user message) — see the "Fake model" decision in
// docs/adr/0010-chat-assistant-with-tools.md.

let fakeToolCallCounter = 0

function nextFakeToolCallId(): string {
  fakeToolCallCounter += 1
  return `fake-call-${fakeToolCallCounter}`
}

function fakeUserText(message: ChatMessage): string {
  return message.role === 'user'
    ? message.content.filter((part): part is ChatTextPart => part.type === 'text').map(part => part.text).join(' ')
    : ''
}

function fakeHasImage(message: ChatMessage): boolean {
  return message.role === 'user' && message.content.some(part => part.type === 'image_url')
}

function findLastIndexByRole(messages: ChatMessage[], role: ChatMessage['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) {
      return i
    }
  }
  return -1
}

/**
 * The result array of a tool outcome, whether it's the bare array a few
 * tools still return, or the `{ items, truncated, total? }` envelope the
 * capped read tools use (assistant-tools.ts `capResult`) — `null` if
 * `parsed` is neither.
 */
function fakeResultItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (isRecord(parsed) && Array.isArray(parsed.items)) {
    return parsed.items
  }
  return null
}

// Matches "such"/"suche"/"suchen"/"finde" as whole words only — `lower.includes('such')`
// used to also fire on "versuche", "untersuche" or "Suchtkarte".
const FAKE_SEARCH_INTENT_PATTERN = /\bsuch(?:e|en)?\b|\bfinde\b/i

/** Extracts the search term after "suche/such/finde [nach] <term>" — falls back to the last word(s) rather than the whole sentence when the keyword itself can't be isolated. */
function fakeExtractSearchQuery(text: string): string {
  const match = text.match(/\b(?:such(?:e|en)?|finde)\b\s*(?:nach\s+)?(.+)$/i)
  const query = match?.[1]?.trim()
  if (query && query !== '') {
    return query
  }
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(-3).join(' ')
}

function fakeExtractQuantity(text: string): number {
  const match = text.match(/\d+/)
  return match ? Math.max(1, Number(match[0])) : 1
}

/** The first card-like object (`{ id, name, ... }`) in the most recent tool result, if any. */
function fakeFindLastSearchResultCard(messages: ChatMessage[]): { id: number, name: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== 'tool') {
      continue
    }
    try {
      const items = fakeResultItems(JSON.parse(message.content))
      const first = items?.[0]
      if (items && items.length > 0 && isRecord(first) && typeof first.id === 'number') {
        const name = typeof first.name === 'string' ? first.name : `#${first.id}`
        return { id: first.id, name }
      }
    }
    catch {
      // Not JSON at all — keep scanning further back.
    }
  }
  return null
}

function fakeToolCallResult(name: string, args: Record<string, unknown>, text = ''): ChatModelResult {
  return {
    text,
    toolCalls: [{ id: nextFakeToolCallId(), name, arguments: JSON.stringify(args) }],
    finishReason: 'tool_calls',
  }
}

function fakeTextResult(text: string): ChatModelResult {
  return { text, toolCalls: [], finishReason: 'stop' }
}

const FAKE_DECK_INTENT_PATTERN = /\bdeck\b/i
const FAKE_ADD_INTENT_PATTERN_EN = /\badd\b/i

/**
 * Proves the linked deck's context block (assistant-chat.ts
 * `buildDeckContextBlock`) reached the system prompt: answers with the deck
 * name and card total read back from it.
 */
function fakeDeckContextAnswer(system: string): string {
  const name = system.match(/^Deck name: (.*)$/m)?.[1] ?? '?'
  const counts = system.match(/^Counts: Main (\d+) · Extra (\d+) · Side (\d+)$/m)
  const total = counts ? Number(counts[1]) + Number(counts[2]) + Number(counts[3]) : 0
  return `Kontext-Deck: ${name} (${total} Karten)`
}

async function fakeChat(input: ChatModelInput, handlers: ChatStreamHandlers): Promise<ChatModelResult> {
  const messages = input.messages
  const lastUserIndex = findLastIndexByRole(messages, 'user')
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined
  const alreadyRanToolThisTurn = lastUserIndex >= 0
    && messages.slice(lastUserIndex + 1).some(message => message.role === 'tool')

  const text = lastUser ? fakeUserText(lastUser) : ''
  const lower = text.toLowerCase()
  const isSearchIntent = FAKE_SEARCH_INTENT_PATTERN.test(lower)
  // German trigger words, plus English "add" for English-UI tests.
  const isAddIntent = lower.includes('hinzufügen') || lower.includes('füge') || FAKE_ADD_INTENT_PATTERN_EN.test(lower)
  const hasImage = lastUser ? fakeHasImage(lastUser) : false

  let result: ChatModelResult

  if (alreadyRanToolThisTurn) {
    if (isAddIntent) {
      result = fakeTextResult('Ich habe einen Vorschlag angelegt.')
    }
    else {
      const lastToolMessage = messages[findLastIndexByRole(messages, 'tool')]
      let count = 0
      let names: string[] = []
      if (lastToolMessage?.role === 'tool') {
        try {
          const items = fakeResultItems(JSON.parse(lastToolMessage.content))
          if (items) {
            count = items.length
            names = items.flatMap(item => (isRecord(item) && typeof item.name === 'string') ? [item.name] : [])
          }
        }
        catch {
          // Not JSON at all — report zero results.
        }
      }
      result = fakeTextResult(`Ich habe ${count} ${count === 1 ? 'Karte' : 'Karten'} gefunden: ${names.join(', ')}`)
    }
  }
  else if (hasImage) {
    result = {
      text: 'Auf dem Bild sehe ich: Dark Magician.',
      toolCalls: [{ id: nextFakeToolCallId(), name: 'search_catalog', arguments: JSON.stringify({ query: 'Dark Magician' }) }],
      finishReason: 'tool_calls',
    }
  }
  else if (isSearchIntent) {
    result = fakeToolCallResult('search_catalog', { query: fakeExtractSearchQuery(text) })
  }
  else if (isAddIntent) {
    const card = fakeFindLastSearchResultCard(messages)
    result = card
      ? fakeToolCallResult('add_to_inventory', { items: [{ catalogCardId: card.id, quantity: fakeExtractQuantity(text) }] })
      : fakeTextResult('Ich habe keine passende Karte gefunden.')
  }
  else if (FAKE_DECK_INTENT_PATTERN.test(text) && input.system.includes('Deck ID:')) {
    result = fakeTextResult(fakeDeckContextAnswer(input.system))
  }
  else {
    result = fakeTextResult(`Testantwort: ${text}`)
  }

  if (result.text !== '') {
    handlers.onTextDelta(result.text)
  }
  if (result.toolCalls.length > 0) {
    handlers.onToolCallDelta?.()
  }

  return result
}

export function createFakeModel(): DeckAssistantModel {
  return {
    id: FAKE_MODEL_ID,
    chat: fakeChat,
  }
}

// --- Configuration ------------------------------------------------------------
//
// Resolution (provider auto-detection, OPENAI_API_KEY fallback, defaults)
// lives in assistant-model.ts, shared with the AI SDK engine (ADR 0020).

export function useDeckAssistantModel(): DeckAssistantModel | null {
  const config = useAssistantRuntimeConfig()
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return createFakeModel()
  }
  if (provider === 'openai') {
    return createOpenAiCompatibleModel({
      baseUrl: resolveBaseUrl(config),
      apiKey: resolveApiKey(config),
      model: resolveModelId(config),
      reasoningEffort: resolveReasoningEffort(config),
      visionModel: resolveVisionModel(config) || undefined,
      timeoutMs: getAssistantLimits().timeoutMs,
    })
  }
  return null
}
