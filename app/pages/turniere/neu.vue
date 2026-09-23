<script setup lang="ts">
import {
  PAIRING_SYSTEM_DESCRIPTIONS,
  PAIRING_SYSTEM_LABELS,
  PAIRING_SYSTEMS,
  TOURNAMENT_ERROR_MESSAGES,
} from '~~/shared/tournaments'
import type { PairingSystem, TournamentDetail, TournamentErrorCode } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

useHead({ title: 'Neues Turnier – yugioh alpha' })

// reka-ui reserves the empty string for "clear selection", so "no format"
// uses a sentinel that maps back to `null` on the wire (same convention as
// the deck editor's format select).
const NO_FORMAT = 'none'

interface RuleFormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

const { data: formatsData } = await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const formatItems = computed(() => [
  { label: 'Ohne Format', value: NO_FORMAT },
  ...(formatsData.value?.items ?? []).map(format => ({ label: format.name, value: format.id })),
])

const pairingSystemItems = PAIRING_SYSTEMS.map(system => ({ label: PAIRING_SYSTEM_LABELS[system], value: system }))

const form = reactive({
  name: '',
  description: '',
  formatId: NO_FORMAT,
  pairingSystem: 'swiss' as PairingSystem,
  plannedRounds: '',
  includeSelf: true,
})

const isSubmitting = ref(false)
// The name check belongs to its UFormField (aria-describedby/aria-invalid);
// errorMessage is for the server's answer.
const nameError = ref('')
const errorMessage = ref('')

watch(() => form.name, (name) => {
  if (name.trim()) {
    nameError.value = ''
  }
})

function errorText(error: unknown, fallback: string) {
  const code = apiErrorCode(error) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(error, fallback)
}

async function submit() {
  if (isSubmitting.value) {
    return
  }
  if (!form.name.trim()) {
    nameError.value = 'Bitte einen Namen angeben.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const created = await $fetch<TournamentDetail>('/api/tournaments', {
      method: 'POST',
      body: {
        name: form.name,
        description: form.description || null,
        formatId: form.formatId === NO_FORMAT ? null : form.formatId,
        pairingSystem: form.pairingSystem,
        plannedRounds: form.plannedRounds.trim() === '' ? null : Number(form.plannedRounds),
        includeSelf: form.includeSelf,
      },
    })
    await navigateTo(`/turniere/${created.id}`)
  }
  catch (error) {
    errorMessage.value = errorText(error, 'Das Turnier konnte nicht angelegt werden.')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        to="/turniere"
        label="Zurück zu den Turnieren"
      />
      <LayoutPageHeader
        title="Neues Turnier"
        description="Spieler lädst du nach dem Anlegen per E-Mail oder als Gast ein."
      />
    </div>

    <form
      class="space-y-4 rounded-md border border-gray-200 bg-white p-4"
      @submit.prevent="submit"
    >
      <UFormField
        label="Turniername"
        :error="nameError"
      >
        <UInput
          v-model="form.name"
          placeholder="z. B. Freitagsturnier"
          maxlength="80"
          aria-label="Turniername"
        />
      </UFormField>

      <UFormField label="Beschreibung (optional)">
        <UTextarea
          v-model="form.description"
          :rows="3"
          maxlength="500"
          aria-label="Beschreibung"
        />
      </UFormField>

      <UFormField label="Format">
        <USelect
          v-model="form.formatId"
          :items="formatItems"
          aria-label="Format"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Paarungssystem">
        <USelect
          v-model="form.pairingSystem"
          :items="pairingSystemItems"
          aria-label="Paarungssystem"
          class="w-full"
        />
        <p class="mt-1 text-xs text-gray-500">
          {{ PAIRING_SYSTEM_DESCRIPTIONS[form.pairingSystem] }}
        </p>
      </UFormField>

      <UFormField label="Geplante Runden">
        <UInput
          v-model="form.plannedRounds"
          type="number"
          min="1"
          max="20"
          placeholder="Automatisch"
          aria-label="Geplante Runden"
          :disabled="form.pairingSystem === 'round_robin'"
        />
        <p class="mt-1 text-xs text-gray-500">
          {{ form.pairingSystem === 'round_robin'
            ? 'Bei "Jeder gegen jeden" ergibt sich die Rundenzahl aus der Teilnehmerzahl.'
            : 'Leer lassen: wird beim Start aus der Teilnehmerzahl berechnet.' }}
        </p>
      </UFormField>

      <UCheckbox
        v-model="form.includeSelf"
        label="Ich spiele selbst mit"
      />

      <p
        v-if="errorMessage"
        role="alert"
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
          to="/turniere"
        />
        <UButton
          type="submit"
          icon="i-lucide-plus"
          label="Turnier anlegen"
          :loading="isSubmitting"
        />
      </div>
    </form>
  </div>
</template>
