<script setup lang="ts">
import { DECK_SECTIONS, DECK_SECTION_LABELS } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import { PLAY_STYLES } from '~~/shared/deck-assistant'
import type { DeckAssistantResult, DeckAssistantStatus, PlayStyleId } from '~~/shared/deck-assistant'
import { apiErrorMessage } from '~/utils/card-entry'
import type { AssistantRequestPayload } from '~/components/decks/AssistantRequestForm.vue'

useHead({ title: 'KI-Deckassistent – yugioh alpha' })

const toast = useToast()

const { data: status } = await useFetch<DeckAssistantStatus>('/api/assistant/status', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }),
})

const result = ref<DeckAssistantResult | null>(null)
const isSubmitting = ref(false)
const errorMessage = ref('')
const lastPlayStyle = ref<PlayStyleId>('balanced')

async function handleSubmit(payload: AssistantRequestPayload) {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''
  lastPlayStyle.value = payload.playStyle

  try {
    result.value = await $fetch<DeckAssistantResult>('/api/assistant/suggest', {
      method: 'POST',
      body: {
        mode: 'build',
        formatId: payload.formatId ?? null,
        playStyle: payload.playStyle,
        notes: payload.notes || undefined,
        includeMissing: payload.includeMissing,
      },
    })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Vorschläge konnten nicht erzeugt werden.')
  }
  finally {
    isSubmitting.value = false
  }
}

function reset() {
  result.value = null
  errorMessage.value = ''
}

function deckSection(section: DeckSection) {
  return result.value?.deck?.[section] ?? []
}

function sectionCount(section: DeckSection): number {
  return deckSection(section).reduce((total, entry) => total + entry.quantity, 0)
}

// --- Save as deck ------------------------------------------------------------

const isSaveModalOpen = ref(false)
const saveForm = reactive({ name: '', includeMissing: false })
const isSaving = ref(false)
const saveError = ref('')

function openSaveModal() {
  const styleLabel = PLAY_STYLES.find(style => style.id === lastPlayStyle.value)?.label ?? ''
  saveForm.name = `KI-Deck – ${styleLabel}`
  saveForm.includeMissing = false
  saveError.value = ''
  isSaveModalOpen.value = true
}

// Mirrors MAX_DECK_CREATE_CARDS / MAX_DECK_CARD_QUANTITY in server/utils/decks.ts
// (not importable from the app — server-only module).
const MAX_DECK_CREATE_CARDS = 100
const MAX_DECK_CARD_QUANTITY = 99

function buildCardsPayload(): Array<{ catalogCardId: number, section: DeckSection, quantity: number }> {
  if (!result.value?.deck) {
    return []
  }

  const merged = new Map<string, { catalogCardId: number, section: DeckSection, quantity: number }>()
  const addEntry = (catalogCardId: number, section: DeckSection, quantity: number) => {
    const key = `${catalogCardId}:${section}`
    const existing = merged.get(key)
    if (existing) {
      existing.quantity = Math.min(MAX_DECK_CARD_QUANTITY, existing.quantity + quantity)
    }
    else {
      merged.set(key, { catalogCardId, section, quantity })
    }
  }

  for (const section of DECK_SECTIONS) {
    for (const entry of result.value.deck[section]) {
      addEntry(entry.catalogCardId, entry.section, entry.quantity)
    }
  }

  if (saveForm.includeMissing) {
    for (const missing of result.value.missing) {
      addEntry(missing.catalogCardId, missing.section, missing.quantity)
    }
  }

  return [...merged.values()].slice(0, MAX_DECK_CREATE_CARDS)
}

async function saveAsDeck() {
  if (!result.value) {
    return
  }
  if (!saveForm.name.trim()) {
    saveError.value = 'Bitte einen Namen angeben.'
    return
  }

  isSaving.value = true
  saveError.value = ''

  try {
    const cards = buildCardsPayload()
    const created = await $fetch<{ id: string, name: string }>('/api/decks', {
      method: 'POST',
      body: { name: saveForm.name.trim(), cards },
    })

    if (result.value.formatId) {
      await $fetch(`/api/decks/${created.id}`, {
        method: 'PATCH',
        body: { formatId: result.value.formatId },
      })
    }

    toast.add({ title: `"${created.name}" erstellt`, color: 'success' })
    isSaveModalOpen.value = false
    await navigateTo(`/decks/${created.id}`)
  }
  catch (error) {
    saveError.value = apiErrorMessage(error, 'Das Deck konnte nicht gespeichert werden.')
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <NuxtLink
        to="/decks"
        class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        Zurück zu den Decks
      </NuxtLink>
      <h1 class="mt-2 text-2xl font-semibold text-gray-900">
        KI-Deckassistent
      </h1>
      <p class="mt-1 max-w-prose text-sm text-gray-500">
        Lass dir aus deinem Inventar einen kompletten Deckvorschlag erstellen.
      </p>
    </div>

    <UAlert
      v-if="!status?.enabled"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Der KI-Assistent ist nicht konfiguriert. Setze NUXT_ASSISTANT_API_KEY (oder OPENAI_API_KEY) bzw. NUXT_ASSISTANT_BASE_URL auf dem Server."
    />

    <template v-else>
      <section
        v-if="!result"
        class="max-w-xl rounded-md border border-gray-200 bg-white p-4"
      >
        <DecksAssistantRequestForm
          mode="build"
          :loading="isSubmitting"
          @submit="handleSubmit"
        />

        <p
          v-if="isSubmitting"
          class="mt-4 text-sm text-gray-500"
        >
          Der Assistent stellt dein Deck zusammen … das kann bis zu einer Minute dauern.
        </p>

        <p
          v-if="errorMessage"
          class="mt-4 text-sm text-red-600"
        >
          {{ errorMessage }}
        </p>
      </section>

      <template v-else>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="max-w-prose text-sm text-gray-700">
            {{ result.summary }}
          </p>
          <div class="flex shrink-0 gap-2">
            <UButton
              icon="i-lucide-save"
              label="Als Deck speichern"
              @click="openSaveModal"
            />
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              label="Neuen Vorschlag"
              @click="reset"
            />
          </div>
        </div>

        <UAlert
          v-if="result.warnings.length > 0"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Hinweise"
        >
          <template #description>
            <ul class="list-inside list-disc space-y-0.5">
              <li
                v-for="(warning, index) in result.warnings"
                :key="index"
              >
                {{ warning }}
              </li>
            </ul>
          </template>
        </UAlert>

        <DecksAssistantValidationSummary
          :validation="result.validation"
          :format-name="result.formatName"
        />

        <div
          role="region"
          aria-label="Deckvorschlag (aus deinem Inventar)"
          class="space-y-6"
        >
          <h2 class="text-base font-semibold text-gray-900">
            Deckvorschlag (aus deinem Inventar)
          </h2>

          <section
            v-for="section in DECK_SECTIONS"
            :key="section"
            class="rounded-md border border-gray-200 bg-white"
          >
            <header class="border-b border-gray-200 px-4 py-3">
              <h3 class="text-sm font-semibold text-gray-900">
                {{ DECK_SECTION_LABELS[section] }} ({{ sectionCount(section) }})
              </h3>
            </header>

            <p
              v-if="deckSection(section).length === 0"
              class="px-4 py-4 text-sm text-gray-500"
            >
              Keine Karten für {{ DECK_SECTION_LABELS[section] }} vorgeschlagen.
            </p>
            <ul
              v-else
              class="divide-y divide-gray-100"
            >
              <li
                v-for="entry in deckSection(section)"
                :key="`${section}-${entry.catalogCardId}`"
                class="px-4 py-2"
              >
                <p class="text-sm font-medium text-gray-900">
                  {{ entry.quantity }}× {{ entry.name }}
                </p>
                <p class="text-xs text-gray-500">
                  Besitz: {{ entry.owned }}
                </p>
                <p class="text-xs text-gray-500">
                  {{ entry.reason }}
                </p>
              </li>
            </ul>
          </section>
        </div>

        <section
          role="region"
          aria-label="Fehlende Karten (nicht oder nicht genug im Inventar)"
          class="rounded-md border border-amber-200 bg-amber-50 p-4"
        >
          <h2 class="flex items-center gap-2 text-base font-semibold text-amber-900">
            <UIcon
              name="i-lucide-triangle-alert"
              class="size-4"
            />
            Fehlende Karten (nicht oder nicht genug im Inventar)
          </h2>

          <p
            v-if="result.missing.length === 0"
            class="mt-2 text-sm text-amber-800"
          >
            Keine fehlenden Karten.
          </p>
          <ul
            v-else
            class="mt-2 divide-y divide-amber-200"
          >
            <li
              v-for="missing in result.missing"
              :key="`missing-${missing.catalogCardId}`"
              class="py-2"
            >
              <p class="text-sm font-medium text-amber-900">
                {{ missing.quantity }}× {{ missing.name }} ({{ DECK_SECTION_LABELS[missing.section] }})
              </p>
              <p class="text-xs text-amber-800">
                Besitz: {{ missing.owned }}
              </p>
              <p class="text-xs text-amber-800">
                {{ missing.reason }}
              </p>
            </li>
          </ul>
        </section>
      </template>
    </template>

    <UModal
      v-model:open="isSaveModalOpen"
      title="Als Deck speichern"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="saveAsDeck"
        >
          <UFormField label="Name">
            <UInput
              v-model="saveForm.name"
              maxlength="80"
              aria-label="Deckname"
            />
          </UFormField>

          <UCheckbox
            v-model="saveForm.includeMissing"
            label="Fehlende Karten mit aufnehmen"
          />

          <p
            v-if="saveError"
            class="text-sm text-red-600"
          >
            {{ saveError }}
          </p>

          <div class="flex justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              label="Abbrechen"
              @click="() => { isSaveModalOpen = false }"
            />
            <UButton
              type="submit"
              icon="i-lucide-save"
              :loading="isSaving"
              label="Speichern"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
