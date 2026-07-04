<script setup lang="ts">
import { authClient } from '~/utils/auth-client'
import { waitForAuthSession } from '~/utils/session'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Anmelden – yugioh alpha' })

const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: signInError } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  })
  loading.value = false

  if (signInError) {
    error.value = signInError.message || 'Anmeldung fehlgeschlagen. Bitte überprüfe deine Angaben.'
    return
  }

  await waitForAuthSession()

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  // Nur interne Pfade zulassen; volle Dokumentnavigation, damit die Session-Prüfung
  // der Middleware das frische Cookie garantiert sieht (kein Client-Cache).
  const target = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
  window.location.assign(target)
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">
      Anmelden
    </h1>
    <p class="mt-1 text-sm text-gray-500">
      Melde dich an, um auf deine Sammlung zuzugreifen.
    </p>

    <form
      class="mt-6 space-y-4"
      @submit.prevent="onSubmit"
    >
      <UFormField label="E-Mail">
        <UInput
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          placeholder="du@example.com"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField label="Passwort">
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
        v-if="error"
        class="text-sm text-red-600"
      >
        {{ error }}
      </p>

      <UButton
        type="submit"
        label="Anmelden"
        block
        :loading="loading"
      />
    </form>

    <p class="mt-6 text-center text-sm text-gray-500">
      Noch kein Konto?
      <NuxtLink
        to="/register"
        class="font-medium text-primary"
      >
        Registrieren
      </NuxtLink>
    </p>
  </div>
</template>
