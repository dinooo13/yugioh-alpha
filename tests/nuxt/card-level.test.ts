// Level, Rank or Link rating with Konami's official words (#101): Xyz ranks
// are stored in `level`, Link ratings in `linkval` (detail payload only).
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { cardLevel } from '~/utils/card-level'
import { setTestLocale } from './fixtures/locale'

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

afterEach(() => setTestLocale('de'))

describe('cardLevel', () => {
  it('reads a level, a rank or a link rating from the stored type', () => {
    expect(cardLevel({ type: 'Normal Monster', level: 4 })).toEqual({ kind: 'level', value: 4 })
    expect(cardLevel({ type: 'XYZ Monster', level: 4 })).toEqual({ kind: 'rank', value: 4 })
    expect(cardLevel({ type: 'XYZ Pendulum Effect Monster', level: 4 })).toEqual({ kind: 'rank', value: 4 })
    expect(cardLevel({ type: 'Link Monster', level: null, linkval: 3 })).toEqual({ kind: 'link', value: 3 })
  })

  it('keeps a level or rank of 0', () => {
    expect(cardLevel({ type: 'Synchro Monster', level: 0 })).toEqual({ kind: 'level', value: 0 })
    expect(cardLevel({ type: 'XYZ Monster', level: 0 })).toEqual({ kind: 'rank', value: 0 })
  })

  it('gives none for a Link monster without linkval, a Spell or a Skill card', () => {
    // YGOPRODeck used to send level 0 for Link monsters; list rows have no linkval.
    expect(cardLevel({ type: 'Link Monster', level: 0 })).toBeNull()
    expect(cardLevel({ type: 'Link Monster', level: null, linkval: null })).toBeNull()
    expect(cardLevel({ type: 'Spell Card', level: null })).toBeNull()
    expect(cardLevel({ type: 'Skill Card', level: null })).toBeNull()
  })
})

describe('useCardText().cardLevelLabel', () => {
  async function labels() {
    let api!: ReturnType<typeof useCardText>
    await mountSuspended(defineComponent({
      setup() {
        api = useCardText()
        return () => h('div')
      },
    }))
    return [
      api.cardLevelLabel({ type: 'Effect Monster', level: 4 }),
      api.cardLevelLabel({ type: 'XYZ Monster', level: 4 }),
      api.cardLevelLabel({ type: 'Link Monster', level: null, linkval: 3 }),
      api.cardLevelLabel({ type: 'Trap Card', level: null }),
    ]
  }

  it('uses Konami\'s German words', async () => {
    expect(await labels()).toEqual(['Stufe 4', 'Rang 4', 'Link 3', null])
  })

  it('uses the English words with an English interface', async () => {
    await setTestLocale('en')

    expect(await labels()).toEqual(['Level 4', 'Rank 4', 'Link 3', null])
  })
})
