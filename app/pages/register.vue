<script setup lang="ts">
import { authClient } from '~/utils/auth-client'
import { waitForAuthSession } from '~/utils/session'
import { authErrorKey } from '~/utils/auth-errors'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
usePageTitle('auth.register.title')

const name = ref('')
const email = ref('')
const password = ref('')
// Only checked by the server, and only when it has an invite code set (ADR 0027).
const inviteCode = ref('')
// A message key, so the error follows a language switch.
const errorKey = ref('')
const loading = ref(false)

async function onSubmit() {
  errorKey.value = ''

  // Native `required` still blocks submission, but browsers only ever
  // surface that as a focus + a non-localized tooltip — no visible
  // message on the page (UX review #3).
  if (!name.value.trim() || !email.value.trim() || !password.value) {
    errorKey.value = 'auth.allFieldsRequired'
    return
  }

  loading.value = true
  // `inviteCode` isn't in Better Auth's sign-up type; the server's invite
  // gate reads it from the body (server/utils/invite-code.ts).
  const payload = {
    name: name.value || email.value,
    email: email.value,
    password: password.value,
    inviteCode: inviteCode.value.trim(),
  }
  const { error: signUpError } = await authClient.signUp.email(payload)
  loading.value = false

  if (signUpError) {
    errorKey.value = authErrorKey(signUpError) ?? 'auth.register.failed'
    return
  }

  await waitForAuthSession()

  // Volle Navigation, damit die Session-Prüfung der Middleware
  // das frische Cookie garantiert sieht (kein Client-Cache).
  await navigateTo('/', { external: true })
}
</script>

<template>
  <div>
    <h1 class="font-display text-2xl leading-tight font-semibold tracking-[0.01em] text-highlighted">
      {{ t('auth.register.title') }}
    </h1>
    <p class="mt-1 text-sm text-muted">
      {{ t('auth.register.description') }}
    </p>

    <form
      class="mt-6 space-y-4"
      novalidate
      @submit.prevent="onSubmit"
    >
      <UFormField :label="t('auth.fields.name')">
        <UInput
          v-model="name"
          name="name"
          autocomplete="name"
          :placeholder="t('auth.fields.namePlaceholder')"
          class="w-full"
          required
        />
      </UFormField>

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

      <UFormField
        :label="t('auth.fields.password')"
        :help="t('auth.register.passwordHelp')"
      >
        <UInput
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
          placeholder="••••••••"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField
        :label="t('auth.fields.inviteCode')"
        :help="t('auth.register.inviteCodeHelp')"
      >
        <UInput
          v-model="inviteCode"
          name="inviteCode"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          class="w-full"
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
        :label="t('auth.register.submit')"
        block
        size="lg"
        class="btn-summon"
        :loading="loading"
      />
    </form>

    <i18n-t
      keypath="auth.register.hasAccount"
      tag="p"
      class="mt-6 text-center text-sm text-muted"
      scope="global"
    >
      <template #link>
        <NuxtLink
          to="/login"
          class="font-medium text-primary"
        >
          {{ t('auth.register.loginLink') }}
        </NuxtLink>
      </template>
    </i18n-t>
  </div>
</template>
