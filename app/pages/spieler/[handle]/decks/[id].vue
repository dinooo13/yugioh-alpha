<script setup lang="ts">
import type { SharedDeckView } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()

const { data, error } = await useFetch<SharedDeckView>(
  () => `/api/profiles/${route.params.handle}/decks/${route.params.id}`,
  {
    query: computed(() => ({ token: route.query.token || undefined })),
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  },
)

useHead({
  title: computed(() => `${data.value?.deck.name ?? 'Deck'} – yugioh alpha`),
  meta: [
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ],
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="error"
      class="rounded-md border border-gray-200 bg-white px-6 py-12 text-center"
    >
      <h1 class="text-lg font-semibold text-gray-900">
        Nicht gefunden oder nicht freigegeben.
      </h1>
      <p class="mt-2 text-sm text-gray-500">
        Vielleicht ist der Link abgelaufen oder die Freigabe wurde zurückgenommen.
      </p>
    </div>

    <template v-else-if="data">
      <div>
        <NuxtLink
          :to="`/spieler/${route.params.handle}`"
          class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <UIcon
            name="i-lucide-arrow-left"
            class="size-4"
          />
          Zurück zum Profil
        </NuxtLink>
      </div>

      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-semibold text-gray-900">
            {{ data.deck.name }}
          </h1>
          <p class="mt-1 text-sm text-gray-500">
            Geteilt von {{ data.owner.displayName }}
          </p>
          <p
            v-if="data.deck.description"
            class="mt-1 max-w-prose text-sm text-gray-500"
          >
            {{ data.deck.description }}
          </p>
          <p class="mt-1 text-sm text-gray-500">
            {{ data.counts.total }} Karte<span v-if="data.counts.total !== 1">n</span> insgesamt · Nur ansehen
          </p>
        </div>

        <UButton
          v-if="data.isOwner"
          icon="i-lucide-pencil"
          label="Bearbeiten"
          :to="`/decks/${route.params.id}`"
        />
      </div>

      <UAlert
        v-if="data.format"
        color="neutral"
        variant="subtle"
        :title="data.format.name"
        :description="data.validation ? (data.validation.legal ? 'Legal' : 'Nicht legal') : undefined"
      />

      <UAlert
        v-if="data.warnings.length > 0"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Hinweise zum Deckaufbau"
      >
        <template #description>
          <ul class="list-inside list-disc space-y-0.5">
            <li
              v-for="warning in data.warnings"
              :key="`${warning.code}-${warning.cardId ?? ''}`"
            >
              {{ warning.message }}
            </li>
          </ul>
        </template>
      </UAlert>

      <SharingSharedDeckSections
        :sections="data.sections"
        :counts="data.counts"
      />
    </template>
  </div>
</template>
