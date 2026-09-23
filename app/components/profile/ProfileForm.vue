<script setup lang="ts">
import type { OwnProfile } from '~~/shared/sharing'
import { apiErrorCode } from '~/utils/card-entry'

const HANDLE_PATTERN = /^[a-z0-9-]+$/

const props = defineProps<{
  profile: OwnProfile
}>()

const emit = defineEmits<{
  saved: [profile: OwnProfile]
}>()

const { t } = useI18n()
const apiError = useApiError()

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
// Field-level problems go to their UFormField (wired up via
// aria-describedby/aria-invalid); errorMessage is for everything else.
const handleError = ref('')
const displayNameError = ref('')
const errorMessage = ref('')
const saved = ref(false)
// Shown once, right after a save that actually changed the handle (UX
// review #23) — every `/players/<altes-handle>/...` link already handed out
// breaks the moment this happens, and that consequence was previously
// undisclosed.
const handleChangedNotice = ref(false)

// Live preview of the public profile URL as the visitor would see it — the
// rule text below used to only appear after a failed submit.
const handlePreview = computed(() => `/players/${form.handle.trim().toLowerCase() || '…'}`)

async function save() {
  errorMessage.value = ''
  handleError.value = ''
  displayNameError.value = ''
  saved.value = false
  handleChangedNotice.value = false

  const handle = form.handle.trim().toLowerCase()
  if (handle.length < 3 || handle.length > 30 || !HANDLE_PATTERN.test(handle)) {
    handleError.value = t('profile.form.handleInvalid')
  }
  if (!form.displayName.trim()) {
    displayNameError.value = t('profile.form.displayNameRequired')
  }
  if (handleError.value || displayNameError.value) {
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
    saved.value = true
    handleChangedNotice.value = updated.handle !== previousHandle
    emit('saved', updated)
  }
  catch (error) {
    const statusCode = (error as { data?: { statusCode?: number } } | null)?.data?.statusCode
    const code = apiErrorCode(error)
    if (statusCode === 409 || code?.startsWith('handle_')) {
      handleError.value = statusCode === 409 ? t('errors.api.handle_taken') : apiError(error, 'profile.form.handleInvalid')
    }
    else if (code?.startsWith('display_name_')) {
      displayNameError.value = apiError(error, 'profile.form.displayNameRequired')
    }
    else {
      errorMessage.value = apiError(error, 'profile.form.saveFailed')
    }
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
    <UFormField
      :label="t('profile.form.displayName')"
      :error="displayNameError"
    >
      <UInput
        v-model="form.displayName"
        name="displayName"
        maxlength="60"
        :aria-label="t('profile.form.displayName')"
      />
    </UFormField>

    <UFormField
      :label="t('profile.form.handle')"
      :error="handleError"
    >
      <UInput
        v-model="form.handle"
        name="handle"
        maxlength="30"
        :aria-label="t('profile.form.handle')"
      />
      <template #help>
        <i18n-t
          keypath="profile.form.handleHelp"
          scope="global"
        >
          <template #url>
            <span class="font-medium text-gray-700">{{ handlePreview }}</span>
          </template>
        </i18n-t>
      </template>
    </UFormField>

    <UFormField :label="t('profile.form.bio')">
      <UTextarea
        v-model="form.bio"
        name="bio"
        :rows="3"
        maxlength="500"
        :aria-label="t('profile.form.bio')"
      />
    </UFormField>

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>
    <p
      v-if="saved"
      class="text-sm text-emerald-600"
    >
      {{ t('common.saved') }}
    </p>
    <p
      v-if="handleChangedNotice"
      class="text-sm text-amber-600"
    >
      {{ t('profile.form.handleChanged') }}
    </p>

    <div class="flex justify-end">
      <UButton
        type="submit"
        icon="i-lucide-save"
        :loading="isSubmitting"
        :label="t('common.save')"
      />
    </div>
  </form>
</template>
