import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LoginPage from '~/pages/login.vue'
import { setTestLocale } from './fixtures/locale'

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

afterEach(() => setTestLocale('de'))

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

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

  it('announces a failed login to assistive tech via role="alert"', async () => {
    state.signInError = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }
    const component = await mountSuspended(LoginPage)

    expect(component.find('[role="alert"]').exists()).toBe(false)

    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('whatever')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    const alert = component.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('E-Mail-Adresse oder Passwort ist falsch.')
  })

  it('renders in English, including translated better-auth errors', async () => {
    await setTestLocale('en')
    state.signInError = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }
    const component = await mountSuspended(LoginPage)

    expect(component.find('h1').text()).toBe('Sign in')
    expect(component.text()).toContain('No account yet? Register')
    expect(component.find('input[type="email"]').attributes('placeholder')).toBe('you@example.com')

    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('whatever')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    expect(component.find('[role="alert"]').text()).toBe('The email address or password is incorrect.')
  })

  it('falls back to a generic message for an unknown better-auth code', async () => {
    state.signInError = { code: 'SOMETHING_NEW', message: 'Something new' }
    const component = await mountSuspended(LoginPage)

    await component.find('input[type="email"]').setValue('ux@example.com')
    await component.find('input[type="password"]').setValue('whatever')
    await component.find('form').trigger('submit')
    await component.vm.$nextTick()

    expect(component.find('[role="alert"]').text()).toBe('Anmeldung fehlgeschlagen. Bitte überprüfe deine Angaben.')
  })
})
