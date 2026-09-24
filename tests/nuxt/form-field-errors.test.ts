import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ProfileForm from '~/components/profile/ProfileForm.vue'
import RuleFormatEditor from '~/components/formats/RuleFormatEditor.vue'
import DeckFormModal from '~/components/decks/DeckFormModal.vue'
import CollectionFormModal from '~/components/collections/CollectionFormModal.vue'
import NewTournamentPage from '~/pages/tournaments/new.vue'
import type { OwnProfile } from '~~/shared/sharing'
import { MAX_PLANNED_ROUNDS } from '~~/shared/tournaments'
import { setTestLocale } from './fixtures/locale'

// #60: UFormField declares `error` as Boolean|String, and Vue's boolean
// casting turns `''` into `true`. A field bound to an empty error ref was
// therefore marked invalid (red outline, aria-invalid="true") before the
// user typed anything, and again after they fixed it. The forms bind
// `error || undefined` instead.

mockNuxtImport('useFetch', () => {
  return (_url: unknown, options?: { default?: () => unknown }) => ({
    data: ref(options?.default?.() ?? null),
    pending: ref(false),
    error: ref(null),
    refresh: vi.fn(),
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await setTestLocale('de')
})

function profile(): OwnProfile {
  return {
    userId: 'user-a',
    handle: 'fabian',
    displayName: 'Fabian',
    bio: null,
    inventoryVisibility: 'private',
    wishlistVisibility: 'private',
    locale: null,
    cardLocale: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }
}

/** aria-invalid of every element that has one; Vue renders `false` as "false". */
function invalidFlags(root: ParentNode): Array<string | null> {
  return [...root.querySelectorAll('[aria-invalid]')].map(element => element.getAttribute('aria-invalid'))
}

describe('form fields are not invalid before the user did anything (#60)', () => {
  it('profile form', async () => {
    const component = await mountSuspended(ProfileForm, { props: { profile: profile() } })

    expect(component.findAll('input').length).toBeGreaterThan(0)
    for (const flag of invalidFlags(component.element.parentElement!)) {
      expect(flag).not.toBe('true')
    }
  })

  it('rule format editor', async () => {
    const component = await mountSuspended(RuleFormatEditor)

    expect(component.findAll('input').length).toBeGreaterThan(0)
    for (const flag of invalidFlags(component.element.parentElement!)) {
      expect(flag).not.toBe('true')
    }
  })

  // UModal teleports its content to <body>, so these read the document.
  it('deck form modal', async () => {
    document.body.innerHTML = ''
    await mountSuspended(DeckFormModal, { props: { open: true, initialValues: null } })

    expect(document.querySelector('input[name="name"]')).toBeTruthy()
    for (const flag of invalidFlags(document)) {
      expect(flag).not.toBe('true')
    }
  })

  it('collection form modal', async () => {
    document.body.innerHTML = ''
    await mountSuspended(CollectionFormModal, { props: { open: true, initialValues: null } })

    expect(document.querySelector('input[name="name"]')).toBeTruthy()
    for (const flag of invalidFlags(document)) {
      expect(flag).not.toBe('true')
    }
  })

  it('new tournament page', async () => {
    const component = await mountSuspended(NewTournamentPage)

    expect(component.findAll('input').length).toBeGreaterThan(0)
    for (const flag of invalidFlags(component.element.parentElement!)) {
      expect(flag).not.toBe('true')
    }
  })
})

describe('new tournament form', () => {
  it('marks the empty name invalid on submit and clears it once a name is typed', async () => {
    const component = await mountSuspended(NewTournamentPage)
    const input = component.find<HTMLInputElement>('input[aria-label="Turniername"]').element

    await component.find('form').trigger('submit')
    await nextTick()

    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')!.split(' ')
    const root = component.element.parentElement!
    const messages = describedBy.map(id => root.querySelector(`[id="${id}"]`)?.textContent?.trim())
    expect(messages).toContain('Bitte einen Namen angeben.')

    input.value = 'Freitagsturnier'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    await nextTick()

    expect(input.getAttribute('aria-invalid')).not.toBe('true')
  })

  it('caps planned rounds at the server limit (#65)', async () => {
    const component = await mountSuspended(NewTournamentPage)

    const plannedRounds = component.find<HTMLInputElement>('input[type="number"]').element
    expect(plannedRounds.max).toBe(String(MAX_PLANNED_ROUNDS))
  })
})

describe(':error bindings in app/', () => {
  // A bare ref bound to `:error` brings #60 back as soon as it holds ''.
  it('never pass a plain string ref to UFormField\'s error prop', () => {
    const root = process.cwd()
    const files = readdirSync(resolve(root, 'app'), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.vue'))
      .map(entry => relative(root, join(entry.parentPath, entry.name)))

    const bindings = files.flatMap(file =>
      [...readFileSync(resolve(root, file), 'utf8').matchAll(/:error="([^"]+)"/g)]
        .map(match => ({ file, expression: match[1]!.trim() })),
    )

    expect(bindings.length).toBeGreaterThan(0)
    expect(bindings.filter(binding => /^[\w.]+$/.test(binding.expression))).toEqual([])
  })
})
