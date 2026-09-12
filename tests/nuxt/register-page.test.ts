import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import RegisterPage from '~/pages/register.vue'

const state = vi.hoisted(() => ({
  signUpError: null as { code?: string, message?: string } | null,
}))

vi.mock('~/utils/auth-client', () => ({
  authClient: {
    signUp: {
      email: vi.fn(async () => ({ error: state.signUpError })),
    },
  },
}))

vi.mock('~/utils/session', () => ({
  waitForAuthSession: vi.fn(async () => true),
}))

describe('register page', () => {
  it('shows a visible German message instead of submitting an empty form', async () => {
    state.signUpError = null
    const component = await mountSuspended(RegisterPage)

    await component.find('form').trigger('submit')

    expect(component.text()).toContain('Bitte fülle alle Felder aus.')
  })

  it('shows a help text with the minimum password length', async () => {
    const component = await mountSuspended(RegisterPage)

    expect(component.text()).toContain('Mindestens 8 Zeichen')
  })

  it('maps a PASSWORD_TOO_SHORT error to German instead of showing it verbatim', async () => {
    state.signUpError = { code: 'PASSWORD_TOO_SHORT', message: 'Password too short' }
    const component = await mountSuspended(RegisterPage)

    await component.find('input[name="name"]').setValue('UX Tester')
    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('short')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Das Passwort muss mindestens 8 Zeichen lang sein.')
    expect(component.text()).not.toContain('Password too short')
  })

  it('maps a USER_ALREADY_EXISTS error to German', async () => {
    state.signUpError = { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists. Use another email.' }
    const component = await mountSuspended(RegisterPage)

    await component.find('input[name="name"]').setValue('UX Tester')
    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('a-fine-password')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Diese E-Mail-Adresse ist bereits registriert.')
  })
})
