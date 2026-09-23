<script setup lang="ts">
const { t } = useI18n()
const formatCount = useCount()
usePageTitle('dashboard.title')

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
    title: t('dashboard.cards.inventory.title'),
    count: inventoryCount.value,
    description: formatCount('dashboard.cards.inventory.count', inventoryCount.value),
    cta: t('dashboard.cards.inventory.cta'),
    to: '/inventory/quick-entry',
    listTo: '/inventory',
  },
  {
    icon: 'i-lucide-layers',
    title: t('dashboard.cards.decks.title'),
    count: deckCount.value,
    description: formatCount('dashboard.cards.decks.count', deckCount.value),
    cta: t('dashboard.cards.decks.cta'),
    to: '/decks?new=1',
    listTo: '/decks',
  },
  {
    icon: 'i-lucide-trophy',
    title: t('dashboard.cards.tournaments.title'),
    count: tournamentCount.value,
    description: formatCount('dashboard.cards.tournaments.count', tournamentCount.value),
    cta: t('dashboard.cards.tournaments.cta'),
    to: '/tournaments/new',
    listTo: '/tournaments',
  },
])
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      :title="t('dashboard.title')"
      :description="t('dashboard.description')"
    />

    <UAlert
      v-if="isFirstRun"
      color="primary"
      variant="subtle"
      icon="i-lucide-sparkles"
      :title="t('dashboard.firstRun.title')"
      :description="t('dashboard.firstRun.description')"
    >
      <template #actions>
        <UButton
          icon="i-lucide-zap"
          :label="t('dashboard.firstRun.cta')"
          to="/inventory/quick-entry"
        />
      </template>
    </UAlert>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="card in cards"
        :key="card.to"
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
