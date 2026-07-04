import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LoginPage from '~/pages/login.vue'

describe('login page', () => {
  it('renders the German login form', async () => {
    const component = await mountSuspended(LoginPage)

    expect(component.text()).toContain('Anmelden')
    expect(component.find('input[name="email"]').exists()).toBe(true)
    expect(component.find('input[name="password"]').exists()).toBe(true)
  })
})
