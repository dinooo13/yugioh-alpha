<script setup lang="ts">
import { DECK_DESCRIPTION_MAX_LENGTH, DECK_NAME_MAX_LENGTH } from '~~/shared/deck-sections'

interface DeckInitialValues {
  id?: string
  name: string
  description: string | null
}

interface SavedDeck {
  id: string
  name: string
  description: string | null
}

const props = defineProps<{
  open: boolean
  initialValues?: DeckInitialValues | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': [deck: SavedDeck, created: boolean]
}>()

const { t } = useI18n()
const apiError = useApiError()

const form = reactive({
  name: '',
  description: '',
})

const isSubmitting = ref(false)
// Field-level problems go to their UFormField (wired up via
// aria-describedby/aria-invalid); errorMessage is for the server's answer.
// Bound as `|| undefined`: UFormField's `error` is Boolean|String, so '' would count as true.
const nameError = ref('')
const errorMessage = ref('')

watch(() => form.name, (name) => {
  if (name.trim()) {
    nameError.value = ''
  }
})

const isEditing = computed(() => Boolean(props.initialValues?.id))
const title = computed(() => isEditing.value ? t('decks.form.editTitle') : t('decks.form.createTitle'))

const openProxy = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

watch(
  () => [props.open, props.initialValues?.id] as const,
  () => {
    if (!props.open) {
      return
    }

    form.name = props.initialValues?.name ?? ''
    form.description = props.initialValues?.description ?? ''
    nameError.value = ''
    errorMessage.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!form.name.trim()) {
    nameError.value = t('decks.form.nameRequired')
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  const payload = {
    name: form.name,
    description: form.description || null,
  }

  try {
    const deckId = props.initialValues?.id
    const saved = deckId
      ? await $fetch<SavedDeck>(`/api/decks/${deckId}`, { method: 'PATCH', body: payload })
      : await $fetch<SavedDeck>('/api/decks', { method: 'POST', body: payload })

    emit('saved', saved, !deckId)
    openProxy.value = false
  }
  catch (error) {
    errorMessage.value = apiError(error, 'decks.form.saveFailed')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    :title="title"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="save"
      >
        <UFormField
          :label="t('decks.form.name')"
          :error="nameError || undefined"
        >
          <UInput
            v-model="form.name"
            name="name"
            :placeholder="t('decks.form.namePlaceholder')"
            :maxlength="DECK_NAME_MAX_LENGTH"
            :aria-label="t('decks.form.nameLabel')"
            autofocus
          />
        </UFormField>

        <UFormField :label="t('decks.form.description')">
          <UTextarea
            v-model="form.description"
            name="description"
            :rows="3"
            :maxlength="DECK_DESCRIPTION_MAX_LENGTH"
            :aria-label="t('decks.form.descriptionLabel')"
          />
        </UFormField>

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="() => { openProxy = false }"
          />
          <UButton
            type="submit"
            icon="i-lucide-save"
            :loading="isSubmitting"
            :label="isEditing ? t('common.save') : t('decks.form.create')"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
