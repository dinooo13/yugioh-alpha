<script setup lang="ts">
import { ASSISTANT_NOTES_MAX, PLAY_STYLES } from '~~/shared/deck-assistant'
import type { PlayStyleId } from '~~/shared/deck-assistant'

export interface AssistantRequestPayload {
  playStyle: PlayStyleId
  notes: string
  includeMissing: boolean
  /** Only meaningful in build mode; omitted (undefined) in improve mode. */
  formatId?: string | null
}

interface RuleFormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

const props = withDefaults(defineProps<{
  mode: 'build' | 'improve'
  loading?: boolean
  submitLabel?: string
}>(), {
  loading: false,
  submitLabel: 'Vorschläge erzeugen',
})

const emit = defineEmits<{
  submit: [payload: AssistantRequestPayload]
}>()

const playStyle = ref<PlayStyleId>('balanced')
const notes = ref('')
const includeMissing = ref(true)

// reka-ui reserves the empty string for "clear selection", so "no format"
// uses a sentinel that maps back to `null` on the wire (same convention as
// the deck editor's format select).
const NO_FORMAT = '__no_format__'
const formatId = ref(NO_FORMAT)

const playStyleItems = PLAY_STYLES.map(style => ({ label: style.label, value: style.id }))

const playStyleDescription = computed(() =>
  PLAY_STYLES.find(style => style.id === playStyle.value)?.description ?? '')

const notesRemaining = computed(() => ASSISTANT_NOTES_MAX - notes.value.length)

// The format picker only makes sense in build mode — an "improve" request
// always defaults to the deck's own format server-side.
const { data: formatsData } = props.mode === 'build'
  ? await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
      headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
      default: () => ({ items: [] }),
    })
  : { data: ref<{ items: RuleFormatListItem[] } | null>(null) }

const formatItems = computed(() => [
  { label: 'Kein Format', value: NO_FORMAT },
  ...(formatsData.value?.items ?? []).map(format => ({
    label: format.isBuiltin ? format.name : `${format.name} (eigenes)`,
    value: format.id,
  })),
])

function submit() {
  if (props.loading) {
    return
  }

  emit('submit', {
    playStyle: playStyle.value,
    notes: notes.value.trim(),
    includeMissing: includeMissing.value,
    formatId: props.mode === 'build' ? (formatId.value === NO_FORMAT ? null : formatId.value) : undefined,
  })
}
</script>

<template>
  <form
    class="space-y-4"
    @submit.prevent="submit"
  >
    <UFormField label="Spielstil">
      <USelect
        v-model="playStyle"
        :items="playStyleItems"
        :disabled="loading"
        aria-label="Spielstil"
        class="w-full"
      />
    </UFormField>
    <p class="-mt-2 text-xs text-gray-500">
      {{ playStyleDescription }}
    </p>

    <UFormField
      v-if="mode === 'build'"
      label="Format"
    >
      <USelect
        v-model="formatId"
        :items="formatItems"
        :disabled="loading"
        aria-label="Format"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Wünsche / Notizen (optional)">
      <UTextarea
        v-model="notes"
        :rows="3"
        :maxlength="ASSISTANT_NOTES_MAX"
        :disabled="loading"
        placeholder="z. B. mehr Fallenkarten, Fokus auf Blue-Eyes …"
        aria-label="Wünsche / Notizen"
        class="w-full"
      />
    </UFormField>
    <p class="-mt-2 text-right text-xs text-gray-400">
      {{ notesRemaining }} Zeichen übrig
    </p>

    <UCheckbox
      v-model="includeMissing"
      :disabled="loading"
      label="Auch fehlende Karten vorschlagen"
    />

    <div class="flex justify-end">
      <UButton
        type="submit"
        icon="i-lucide-sparkles"
        :loading="loading"
        :disabled="loading"
        :label="submitLabel"
      />
    </div>
  </form>
</template>
