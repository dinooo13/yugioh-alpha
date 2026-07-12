<script setup lang="ts">
interface CollectionInitialValues {
  id?: string
  name: string
  description: string | null
}

const props = defineProps<{
  open: boolean
  initialValues?: CollectionInitialValues | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const form = reactive({
  name: '',
  description: '',
})

const isSubmitting = ref(false)
const errorMessage = ref('')

const isEditing = computed(() => Boolean(props.initialValues?.id))
const title = computed(() => isEditing.value ? 'Sammlung umbenennen' : 'Neue Sammlung')

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
    errorMessage.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!form.name.trim()) {
    errorMessage.value = 'Bitte einen Namen angeben.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  const payload = {
    name: form.name,
    description: form.description || null,
  }

  try {
    if (props.initialValues?.id) {
      await $fetch(`/api/collections/${props.initialValues.id}`, {
        method: 'PATCH',
        body: payload,
      })
    }
    else {
      await $fetch('/api/collections', {
        method: 'POST',
        body: payload,
      })
    }

    emit('saved')
    openProxy.value = false
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Sammlung konnte nicht gespeichert werden.'
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
        <UFormField label="Name">
          <UInput
            v-model="form.name"
            name="name"
            placeholder="z. B. Box 1"
            maxlength="60"
          />
        </UFormField>

        <UFormField label="Beschreibung (optional)">
          <UTextarea
            v-model="form.description"
            name="description"
            :rows="3"
            maxlength="500"
          />
        </UFormField>

        <p
          v-if="errorMessage"
          class="text-sm text-red-600"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            label="Abbrechen"
            @click="() => { openProxy = false }"
          />
          <UButton
            type="submit"
            icon="i-lucide-save"
            :loading="isSubmitting"
            :label="isEditing ? 'Speichern' : 'Erstellen'"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
