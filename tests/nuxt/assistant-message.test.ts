import { describe, expect, it } from 'vitest'
import { parseAssistantMessageBlocks } from '~/utils/assistant-message'

// Covers review finding #15's gap: this is the security-relevant parser
// behind MessageBubble.vue (app/components/assistant/MessageBubble.vue) —
// it only ever produces plain-text segments consumed via `{{ }}`
// interpolation, never markup, so a stray HTML-looking string in a model's
// answer must survive as literal text rather than being interpreted.

describe('parseAssistantMessageBlocks', () => {
  it('splits blank-line-separated text into paragraphs', () => {
    const blocks = parseAssistantMessageBlocks('Erster Absatz.\n\nZweiter Absatz.')

    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Erster Absatz.', bold: false }] },
      { type: 'paragraph', segments: [{ text: 'Zweiter Absatz.', bold: false }] },
    ])
  })

  it('joins wrapped lines within one paragraph with a single space', () => {
    const blocks = parseAssistantMessageBlocks('Zeile eins\nZeile zwei')

    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Zeile eins Zeile zwei', bold: false }] },
    ])
  })

  it('turns "- " lines into a list, separate from surrounding paragraphs', () => {
    const blocks = parseAssistantMessageBlocks('Vorschlag:\n- Dark Magician\n- Pot of Greed\n\nBitte bestätigen.')

    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Vorschlag:', bold: false }] },
      {
        type: 'list',
        items: [
          [{ text: 'Dark Magician', bold: false }],
          [{ text: 'Pot of Greed', bold: false }],
        ],
      },
      { type: 'paragraph', segments: [{ text: 'Bitte bestätigen.', bold: false }] },
    ])
  })

  it('marks **bold** spans without emitting the asterisks', () => {
    const blocks = parseAssistantMessageBlocks('Ich schlage **2x Dark Magician** vor.')

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        segments: [
          { text: 'Ich schlage ', bold: false },
          { text: '2x Dark Magician', bold: true },
          { text: ' vor.', bold: false },
        ],
      },
    ])
  })

  it('leaves an unbalanced ** as literal text instead of guessing a close', () => {
    const blocks = parseAssistantMessageBlocks('Das ist **nicht geschlossen.')

    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Das ist **nicht geschlossen.', bold: false }] },
    ])
  })

  it('keeps HTML-looking text as literal segments, never as markup', () => {
    const blocks = parseAssistantMessageBlocks('<script>alert(1)</script> und <img src=x onerror=alert(1)>')

    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: '<script>alert(1)</script> und <img src=x onerror=alert(1)>', bold: false }] },
    ])
  })

  it('returns no blocks for empty content', () => {
    expect(parseAssistantMessageBlocks('')).toEqual([])
    expect(parseAssistantMessageBlocks('   \n\n  ')).toEqual([])
  })
})
