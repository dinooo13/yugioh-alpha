// Model-generated conversation titles (#129). A conversation starts with an
// automatic title — its first message (assistant-turn.ts), "Neue
// Unterhaltung" for a photo-only first message, or "Deck: <name>" for a
// deck-linked one (ADR 0011). After a completed turn the client asks the
// server to name it (`POST /api/assistant/chat/:id/title`): a separate title
// model (`NUXT_ASSISTANT_TITLE_MODEL`) reads the first message and the first
// answer and writes a short title in the interface language.
//
// Outside the turn: it runs after the stream closed and the turn lock was
// released, never takes that lock and never fails a turn. Idempotent: only
// an automatic title is replaced — once the model named the conversation, no
// further model call happens. Any failure keeps the title as it is.

import { and, count, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import type { useDb } from '../db'
import { assistantConversation, assistantMessage } from '../db/schema'
import { ASSISTANT_TITLE_MAX_USER_MESSAGES, deckConversationTitle } from '../../shared/assistant-chat'
import type { AssistantConversationTitleResult } from '../../shared/assistant-chat'
import type { AssistantUIMessage } from '../../shared/assistant-ui'
import type { AppLocale } from '../../shared/locale'
import { conversationTitleFromText, loadDeckRef, requireOwnConversation, toConversationSummary } from './assistant-chat'
import { assistantErrorCode, useAssistantTitleModel } from './assistant-model'
import type { AssistantTitleModel } from './assistant-model'
import { buildTitleInstructions, buildTitlePrompt, TURN_TEXT } from './assistant-prompts'
import { loadUiMessages } from './assistant-ui-messages'

type Db = ReturnType<typeof useDb>

/** One title model call; a slow model only delays the title, never the chat. */
export const TITLE_TIMEOUT_MS = 20_000
/** The prompt asks for 6 words; anything longer is cut. */
const TITLE_WORDS_MAX = 8

/** Conversations whose title is being generated right now — a second request for one of them is skipped. */
const inFlight = new Set<string>()

const QUOTES = '"\'„“”‚‘’«»‹›`'

/** Without the quotes around it ("„Dunkler Magier“"), when it starts and ends with one. */
function unquote(text: string): string {
  return text.length >= 2 && QUOTES.includes(text[0]!) && QUOTES.includes(text.at(-1)!) ? text.slice(1, -1).trim() : text
}

/**
 * The title as the model wrote it, cleaned: without `<think>` blocks, just
 * the first non-empty line, without a "Title:" label, markdown, wrapping
 * quotes or a trailing period, at most `TITLE_WORDS_MAX` words and
 * `ASSISTANT_CONVERSATION_TITLE_MAX` characters. null = nothing usable.
 */
export function cleanGeneratedTitle(raw: string): string | null {
  const withoutThinking = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
  const line = withoutThinking.split(/\r?\n/).map(text => text.trim()).find(text => text !== '') ?? ''
  let title = line
  let previous = ''
  // Labels, markdown and quotes can wrap each other ("**Titel: „…“**").
  while (title !== previous) {
    previous = title
    title = title
      .replace(/^#+\s*/, '')
      .replace(/^(?:\*\*|__|\*|_)+|(?:\*\*|__|\*|_)+$/g, '')
      .replace(/^(?:title|titel)\s*:\s*/i, '')
      .replace(/[.:;]+$/, '')
      .trim()
    title = unquote(title)
  }
  const words = title.split(/\s+/).filter(Boolean).slice(0, TITLE_WORDS_MAX)
  const cleaned = conversationTitleFromText(words.join(' '))
  return cleaned !== '' ? cleaned : null
}

/**
 * The titles a conversation gets without the title model — the only ones it
 * replaces: the first message (as assistant-turn.ts stores it), the default
 * title of a photo-only first message (either language), and "Deck: <name>"
 * of a deck-linked conversation (the deck's current name).
 */
export function automaticTitles(firstUserText: string, deckName?: string | null): string[] {
  return [
    conversationTitleFromText(firstUserText),
    TURN_TEXT.de.defaultConversationTitle,
    TURN_TEXT.en.defaultConversationTitle,
    ...(deckName ? [deckConversationTitle(deckName)] : []),
  ].filter(title => title !== '')
}

/** A message's text as stored (the first message's text is what its automatic title was made from). */
function messageText(message: AssistantUIMessage | undefined): string {
  return (message?.parts ?? []).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n')
}

/** The first user message and the first answer after it, as text. */
function firstExchange(messages: AssistantUIMessage[]): { userText: string, answerText: string } {
  const userIndex = messages.findIndex(message => message.role === 'user')
  if (userIndex < 0) {
    return { userText: '', answerText: '' }
  }
  const answer = messages.slice(userIndex + 1).find(message => message.role === 'assistant')
  return { userText: messageText(messages[userIndex]), answerText: messageText(answer) }
}

export interface GenerateConversationTitleOptions {
  db: Db
  userId: string
  conversationId: string
  /** The interface language — the title's language. */
  locale: AppLocale
  /** Injectable for tests; default: the configured title model (null = titles off). */
  titleModel?: AssistantTitleModel | null
}

/**
 * Names the conversation with the title model when it may (see the file
 * header): the caller's conversation (else 404), its title still automatic,
 * at most `ASSISTANT_TITLE_MAX_USER_MESSAGES` user messages (bounding the
 * retries of a failing model), a title model configured, something to
 * name, and no generation for it already running. The new title only
 * replaces the title read before the call (a concurrent change wins) and
 * leaves `updatedAt` alone, so the list order stays. `generated` = the title
 * was replaced.
 */
export async function generateConversationTitle(options: GenerateConversationTitleOptions): Promise<AssistantConversationTitleResult> {
  const { db, userId, conversationId, locale } = options
  const row = requireOwnConversation(db, userId, conversationId)
  const deckRef = loadDeckRef(db, row.deckId)
  const unchanged = (): AssistantConversationTitleResult => ({ conversation: toConversationSummary(row, deckRef), generated: false })

  const userMessages = db
    .select({ value: count() })
    .from(assistantMessage)
    .where(and(eq(assistantMessage.conversationId, conversationId), eq(assistantMessage.role, 'user')))
    .get()?.value ?? 0
  if (userMessages === 0 || userMessages > ASSISTANT_TITLE_MAX_USER_MESSAGES || inFlight.has(conversationId)) {
    return unchanged()
  }

  const { userText, answerText } = firstExchange(loadUiMessages(db, userId, conversationId))
  const currentTitle = row.title
  if (!automaticTitles(userText, deckRef?.name).includes(currentTitle) || (userText.trim() === '' && answerText.trim() === '')) {
    return unchanged()
  }

  const titleModel = options.titleModel === undefined ? useAssistantTitleModel() : options.titleModel
  if (!titleModel) {
    return unchanged()
  }

  inFlight.add(conversationId)
  let title: string | null
  try {
    const result = await generateText({
      model: titleModel.model,
      instructions: buildTitleInstructions(locale),
      prompt: buildTitlePrompt({ userText: userText.trim(), answerText: answerText.trim() }),
      maxRetries: 1,
      timeout: TITLE_TIMEOUT_MS,
      headers: { 'x-opencode-session': conversationId },
      ...(titleModel.providerOptions ? { providerOptions: titleModel.providerOptions } : {}),
    })
    title = cleanGeneratedTitle(result.text)
  }
  catch (error) {
    console.warn(`[assistant] title generation failed (${assistantErrorCode(error)}):`, error instanceof Error ? error.message : error)
    return unchanged()
  }
  finally {
    inFlight.delete(conversationId)
  }

  if (title === null || title === currentTitle) {
    return unchanged()
  }

  const { changes } = db
    .update(assistantConversation)
    .set({ title })
    .where(and(
      eq(assistantConversation.id, conversationId),
      eq(assistantConversation.userId, userId),
      eq(assistantConversation.title, currentTitle),
    ))
    .run()
  // Re-read: deleted meanwhile → 404; renamed meanwhile → that title stays.
  const updated = requireOwnConversation(db, userId, conversationId)
  return { conversation: toConversationSummary(updated, loadDeckRef(db, updated.deckId)), generated: changes === 1 }
}
