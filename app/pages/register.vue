<script setup lang="ts">
import { authClient } from '~/utils/auth-client'
import { waitForAuthSession } from '~/utils/session'
import { authErrorMessage } from '~/utils/auth-errors'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Registrieren – yugioh alpha' })

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''

  // Native `required` still blocks submission, but browsers only ever
  // surface that as a focus + a non-localized tooltip — no visible German
  // message on the page (UX review #3).
  if (!name.value.trim() || !email.value.trim() || !password.value) {
    error.value = 'Bitte fülle alle Felder aus.'
    return
  }

  loading.value = true
  const { error: signUpError } = await authClient.signUp.email({
    name: name.value || email.value,
    email: email.value,
    password: password.value,
  })
  loading.value = false

  if (signUpError) {
    error.value = authErrorMessage(signUpError, 'Registrierung fehlgeschlagen. Bitte versuche es erneut.')
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
    <h1 class="text-xl font-semibold text-gray-900">
      Registrieren
    </h1>
    <p class="mt-1 text-sm text-gray-500">
      Erstelle ein Konto, um deine Sammlung zu verwalten.
    </p>

    <form
      class="mt-6 space-y-4"
      novalidate
      @submit.prevent="onSubmit"
    >
      <UFormField label="Name">
        <UInput
          v-model="name"
          name="name"
          autocomplete="name"
          placeholder="Dein Name"
          class="w-full"
          required
        />
      </UFormField>

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

      <UFormField
        label="Passwort"
        help="Mindestens 8 Zeichen"
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

      <p
        v-if="error"
        class="text-sm text-red-600"
      >
        {{ error }}
      </p>

      <UButton
        type="submit"
        label="Registrieren"
        block
        :loading="loading"
      />
    </form>

    <p class="mt-6 text-center text-sm text-gray-500">
      Bereits ein Konto?
      <NuxtLink
        to="/login"
        class="font-medium text-primary"
      >
        Anmelden
      </NuxtLink>
    </p>
  </div>
</template>
