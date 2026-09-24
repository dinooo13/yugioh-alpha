<script setup lang="ts">
import { authClient } from '~/utils/auth-client'
import { waitForAuthSession } from '~/utils/session'
import { authErrorKey } from '~/utils/auth-errors'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
usePageTitle('auth.login.title')

const route = useRoute()

const email = ref('')
const password = ref('')
// A message key, so the error follows a language switch.
const errorKey = ref('')
const loading = ref(false)

async function onSubmit() {
  errorKey.value = ''

  if (!email.value.trim() || !password.value) {
    errorKey.value = 'auth.allFieldsRequired'
    return
  }

  loading.value = true
  const { error: signInError } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  })
  loading.value = false

  if (signInError) {
    errorKey.value = authErrorKey(signInError) ?? 'auth.login.failed'
    return
  }

  await waitForAuthSession()

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  // Nur interne Pfade zulassen; volle Navigation, damit die Session-Prüfung
  // der Middleware das frische Cookie garantiert sieht (kein Client-Cache).
  const target = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
  await navigateTo(target, { external: true })
}
</script>

<template>
  <div>
    <h1 class="font-display text-2xl leading-tight font-semibold tracking-[0.01em] text-highlighted">
      {{ t('auth.login.title') }}
    </h1>
    <p class="mt-1 text-sm text-muted">
      {{ t('auth.login.description') }}
    </p>

    <form
      class="mt-6 space-y-4"
      novalidate
      @submit.prevent="onSubmit"
    >
      <UFormField :label="t('auth.fields.email')">
        <UInput
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          :placeholder="t('auth.fields.emailPlaceholder')"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField :label="t('auth.fields.password')">
        <UInput
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="••••••••"
          class="w-full"
          required
        />
      </UFormField>

      <p
        v-if="errorKey"
        role="alert"
        class="text-sm text-error"
      >
        {{ t(errorKey) }}
      </p>

      <UButton
        type="submit"
        :label="t('auth.login.submit')"
        block
        size="lg"
        class="btn-summon"
        :loading="loading"
      />
    </form>

    <i18n-t
      keypath="auth.login.noAccount"
      tag="p"
      class="mt-6 text-center text-sm text-muted"
      scope="global"
    >
      <template #link>
        <NuxtLink
          to="/register"
          class="font-medium text-primary"
        >
          {{ t('auth.login.registerLink') }}
        </NuxtLink>
      </template>
    </i18n-t>
  </div>
</template>
