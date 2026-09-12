<script setup lang="ts">
import type { OwnProfile } from '~~/shared/sharing'
import { apiErrorMessage } from '~/utils/card-entry'

const HANDLE_PATTERN = /^[a-z0-9-]+$/

const props = defineProps<{
  profile: OwnProfile
}>()

const emit = defineEmits<{
  saved: [profile: OwnProfile]
}>()

const form = reactive({
  displayName: props.profile.displayName,
  handle: props.profile.handle,
  bio: props.profile.bio ?? '',
})

watch(() => props.profile, (profile) => {
  form.displayName = profile.displayName
  form.handle = profile.handle
  form.bio = profile.bio ?? ''
})

const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
// Shown once, right after a save that actually changed the handle (UX
// review #23) — every `/spieler/<altes-handle>/...` link already handed out
// breaks the moment this happens, and that consequence was previously
// undisclosed.
const handleChangedNotice = ref(false)

// Live preview of the public profile URL as the visitor would see it — the
// rule text below used to only appear after a failed submit.
const handlePreview = computed(() => `/spieler/${form.handle.trim().toLowerCase() || '…'}`)

async function save() {
  errorMessage.value = ''
  successMessage.value = ''
  handleChangedNotice.value = false

  const handle = form.handle.trim().toLowerCase()
  if (handle.length < 3 || handle.length > 30 || !HANDLE_PATTERN.test(handle)) {
    errorMessage.value = 'Nutzernamen dürfen nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
    return
  }

  if (!form.displayName.trim()) {
    errorMessage.value = 'Bitte einen Anzeigenamen angeben.'
    return
  }

  const previousHandle = props.profile.handle

  isSubmitting.value = true
  try {
    const updated = await $fetch<OwnProfile>('/api/profile', {
      method: 'PATCH',
      body: {
        handle,
        displayName: form.displayName.trim(),
        bio: form.bio.trim() || null,
      },
    })
    successMessage.value = 'Gespeichert'
    handleChangedNotice.value = updated.handle !== previousHandle
    emit('saved', updated)
  }
  catch (error) {
    const statusCode = (error as { data?: { statusCode?: number } } | null)?.data?.statusCode
    errorMessage.value = statusCode === 409
      ? 'Es gibt bereits einen Spieler mit diesem Nutzernamen.'
      : apiErrorMessage(error, 'Profil konnte nicht gespeichert werden.')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <form
    class="space-y-4"
    @submit.prevent="save"
  >
    <UFormField label="Anzeigename">
      <UInput
        v-model="form.displayName"
        name="displayName"
        maxlength="60"
        aria-label="Anzeigename"
      />
    </UFormField>

    <UFormField label="Nutzername">
      <UInput
        v-model="form.handle"
        name="handle"
        maxlength="30"
        aria-label="Nutzername"
      />
      <template #help>
        Nur Kleinbuchstaben, Ziffern und Bindestriche, 3–30 Zeichen. Profil-URL:
        <span class="font-medium text-gray-700">{{ handlePreview }}</span>
      </template>
    </UFormField>

    <UFormField label="Über mich">
      <UTextarea
        v-model="form.bio"
        name="bio"
        :rows="3"
        maxlength="500"
        aria-label="Über mich"
      />
    </UFormField>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>
    <p
      v-if="successMessage"
      class="text-sm text-emerald-600"
    >
      {{ successMessage }}
    </p>
    <p
      v-if="handleChangedNotice"
      class="text-sm text-amber-600"
    >
      Bereits geteilte Links mit dem alten Nutzernamen funktionieren nicht mehr.
    </p>

    <div class="flex justify-end">
      <UButton
        type="submit"
        icon="i-lucide-save"
        :loading="isSubmitting"
        label="Speichern"
      />
    </div>
  </form>
</template>
