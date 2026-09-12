import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LoginPage from '~/pages/login.vue'

const state = vi.hoisted(() => ({
  signInError: null as { code?: string, message?: string } | null,
}))

vi.mock('~/utils/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn(async () => ({ error: state.signInError })),
    },
  },
}))

vi.mock('~/utils/session', () => ({
  waitForAuthSession: vi.fn(async () => true),
}))

describe('login page', () => {
  it('renders the German login form', async () => {
    const component = await mountSuspended(LoginPage)

    expect(component.text()).toContain('Anmelden')
    expect(component.find('input[name="email"]').exists()).toBe(true)
    expect(component.find('input[name="password"]').exists()).toBe(true)
  })

  it('shows a visible German message instead of submitting an empty form', async () => {
    state.signInError = null
    const component = await mountSuspended(LoginPage)

    await component.find('form').trigger('submit')

    expect(component.text()).toContain('Bitte fülle alle Felder aus.')
  })

  it('maps an INVALID_EMAIL_OR_PASSWORD error to German instead of showing it verbatim', async () => {
    state.signInError = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }
    const component = await mountSuspended(LoginPage)

    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('whatever')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    expect(component.text()).toContain('E-Mail-Adresse oder Passwort ist falsch.')
    expect(component.text()).not.toContain('Invalid email or password')
  })
})
