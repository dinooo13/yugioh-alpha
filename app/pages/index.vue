<script setup lang="ts">
import { pluralize } from '~~/shared/plural'

useHead({ title: 'Dashboard – yugioh alpha' })

// Cheap counts for the onboarding cards (UX review #2) — each list endpoint
// already reports a `total`, so a `pageSize: 1` request is enough; no need
// for a dedicated stats endpoint. The inventory count comes from the shared
// collections fetch (`useCollections`): `allCount` sums copies, whereas
// `/api/inventory`'s `total` counts distinct rows.
const { data: collections } = await useCollections()

const { data: decksData } = await useFetch<{ total: number }>('/api/decks', {
  key: 'dashboard-decks-count',
  query: { page: 1, pageSize: 1 },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ total: 0 }),
})

const { data: tournamentsData } = await useFetch<{ total: number }>('/api/tournaments', {
  key: 'dashboard-tournaments-count',
  query: { page: 1, pageSize: 1 },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ total: 0 }),
})

const inventoryCount = computed(() => collections.value?.allCount ?? 0)
const deckCount = computed(() => decksData.value?.total ?? 0)
const tournamentCount = computed(() => tournamentsData.value?.total ?? 0)

const isFirstRun = computed(() => inventoryCount.value === 0 && deckCount.value === 0 && tournamentCount.value === 0)

interface OnboardingCard {
  icon: string
  title: string
  count: number
  description: string
  cta: string
  to: string
  listTo: string
}

const cards = computed<OnboardingCard[]>(() => [
  {
    icon: 'i-lucide-archive',
    title: 'Inventar',
    count: inventoryCount.value,
    description: pluralize(inventoryCount.value, 'Karte im Bestand', 'Karten im Bestand'),
    cta: 'Karten erfassen',
    to: '/inventar/erfassen',
    listTo: '/inventar',
  },
  {
    icon: 'i-lucide-layers',
    title: 'Decks',
    count: deckCount.value,
    description: pluralize(deckCount.value, 'angelegtes Deck', 'angelegte Decks'),
    cta: 'Deck anlegen',
    to: '/decks?neu=1',
    listTo: '/decks',
  },
  {
    icon: 'i-lucide-trophy',
    title: 'Turniere',
    count: tournamentCount.value,
    description: pluralize(tournamentCount.value, 'Turnier', 'Turniere'),
    cta: 'Turnier anlegen',
    to: '/turniere/neu',
    listTo: '/turniere',
  },
])
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      title="Dashboard"
      description="Willkommen bei yugioh alpha — hier siehst du deinen Bestand, deine Decks und anstehende Turniere auf einen Blick."
    />

    <UAlert
      v-if="isFirstRun"
      color="primary"
      variant="subtle"
      icon="i-lucide-sparkles"
      title="Los geht's: Erfasse deine ersten Karten"
      description="Dein Inventar ist noch leer. Erfasse ein paar Karten, um danach dein erstes Deck zusammenzustellen und Turniere zu spielen."
    >
      <template #actions>
        <UButton
          icon="i-lucide-zap"
          label="Karten erfassen"
          to="/inventar/erfassen"
        />
      </template>
    </UAlert>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="card in cards"
        :key="card.title"
        class="flex flex-col rounded-md border border-gray-200 bg-white p-5"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon
              :name="card.icon"
              class="size-5"
            />
          </div>
          <h2 class="text-base font-semibold text-gray-900">
            <NuxtLink
              :to="card.listTo"
              class="hover:text-primary hover:underline"
            >
              {{ card.title }}
            </NuxtLink>
          </h2>
        </div>

        <p class="mt-4 text-3xl font-semibold tabular-nums text-gray-900">
          {{ card.count }}
        </p>
        <p class="mt-1 text-sm text-gray-500">
          {{ card.description }}
        </p>

        <UButton
          class="mt-4 justify-center"
          color="neutral"
          variant="outline"
          :label="card.cta"
          :to="card.to"
        />
      </div>
    </div>
  </div>
</template>
