<script setup lang="ts">
const { t, n } = useI18n()
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

// The "duelist card" greeting (ADR 0016); shares the layout's profile fetch.
const { data: ownProfile } = await useOwnProfile()
const greeting = computed(() => ownProfile.value?.displayName
  ? t('dashboard.hero.greeting', { name: ownProfile.value.displayName })
  : t('dashboard.hero.greetingNoName'))

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
  <div class="space-y-6 lg:space-y-8">
    <!-- The "duelist card": who is playing, on a lit arena surface. -->
    <section class="arena-surface relative overflow-hidden rounded-xl border border-default shadow-panel">
      <LayoutArcaneRings class="absolute top-1/2 -right-28 size-[26rem] -translate-y-1/2 opacity-80 max-md:-top-24 max-md:-right-48 max-md:translate-y-0 xl:right-0" />
      <div class="absolute top-1/2 right-20 hidden -translate-y-1/2 md:block xl:right-[9.5rem]">
        <LayoutCardFan card-class="w-16 xl:w-[4.5rem]" />
      </div>

      <div class="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8 md:pe-56">
        <ProfileAvatar
          v-if="ownProfile"
          :name="ownProfile.displayName"
          :handle="ownProfile.handle"
          size="3xl"
          class="size-16 shrink-0 text-[1.75rem] ring-2 ring-secondary/70 ring-offset-4 ring-offset-bg"
        />
        <div class="min-w-0">
          <h1 class="text-[0.6875rem] font-semibold tracking-[0.18em] text-secondary uppercase">
            {{ t('dashboard.title') }}
          </h1>
          <p class="mt-1.5 font-display text-[clamp(1.625rem,1.2rem+1.8vw,2.625rem)] leading-tight font-semibold break-words text-highlighted">
            {{ greeting }}
          </p>
          <p
            v-if="ownProfile"
            class="mt-1 text-sm text-muted"
          >
            {{ t('sharing.handle', { handle: ownProfile.handle }) }}
          </p>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-toned">
            {{ t('dashboard.description') }}
          </p>
        </div>
      </div>

      <div
        class="gold-hairline absolute inset-x-0 bottom-0"
        aria-hidden="true"
      />
    </section>

    <section
      v-if="isFirstRun"
      class="panel flex flex-col gap-4 p-5 shadow-glow-gold sm:flex-row sm:items-center sm:p-6"
    >
      <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary/10 text-secondary ring-1 ring-secondary/30">
        <UIcon
          name="i-lucide-sparkles"
          class="size-5"
          aria-hidden="true"
        />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-highlighted">
          {{ t('dashboard.firstRun.title') }}
        </h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          {{ t('dashboard.firstRun.description') }}
        </p>
      </div>
      <UButton
        icon="i-lucide-zap"
        size="lg"
        class="btn-summon shrink-0 justify-center"
        :label="t('dashboard.firstRun.cta')"
        to="/inventory/quick-entry"
      />
    </section>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="card in cards"
        :key="card.to"
        class="group panel relative flex flex-col p-5 transition-[box-shadow,border-color] duration-200 hover:border-primary/40 hover:shadow-lift"
      >
        <div class="flex items-center justify-between gap-3">
          <h2 class="flex min-w-0 items-center gap-3 text-sm font-semibold text-highlighted">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/25">
              <UIcon
                :name="card.icon"
                class="size-[1.125rem]"
                aria-hidden="true"
              />
            </span>
            <NuxtLink
              :to="card.listTo"
              class="stretched-link truncate rounded-sm transition-colors group-hover:text-primary"
            >
              {{ card.title }}
            </NuxtLink>
          </h2>
          <UIcon
            name="i-lucide-arrow-up-right"
            class="size-4 shrink-0 text-dimmed transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
        </div>

        <p class="lp-counter mt-6 self-start">
          {{ n(card.count, 'integer') }}
        </p>
        <p class="mt-2 text-sm text-muted">
          {{ card.description }}
        </p>

        <UButton
          class="relative z-10 mt-5 justify-center"
          color="neutral"
          variant="outline"
          :label="card.cta"
          :to="card.to"
        />
      </article>
    </div>
  </div>
</template>
