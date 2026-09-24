<script setup lang="ts">
import type { PublicProfileResponse, SharedWishlistResponse } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()
const { t } = useI18n()
const { cardName } = useCardText()
const count = useCount()
const handle = computed(() => String(route.params.handle ?? ''))

const { data, error } = await useFetch<PublicProfileResponse>(
  () => `/api/profiles/${handle.value}`,
  {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  },
)

// Separate call, mirroring the dedicated `/api/profiles/:handle/wishlist`
// endpoint (§3.2 #13): the main profile response only carries a count, not
// the items themselves. 404s silently (hidden wishlist) — `wishlistItems`
// then just stays empty, same as any other not-shared section on this page.
const { data: wishlistData } = await useFetch<SharedWishlistResponse>(
  () => `/api/profiles/${handle.value}/wishlist`,
  {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  },
)
const wishlistItems = computed(() => wishlistData.value?.items ?? [])

usePageTitle(() => data.value?.profile.displayName ?? t('players.profile.fallbackTitle'))
useHead({
  meta: [
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ],
})

const isEmpty = computed(() => {
  if (!data.value) {
    return false
  }
  return data.value.decks.length === 0
    && data.value.collections.length === 0
    && !data.value.inventory.visible
    && !data.value.wishlist.visible
})
</script>

<template>
  <div class="space-y-6">
    <SharingNotFoundNotice v-if="error" />

    <template v-else-if="data">
      <!-- Profile header (ADR 0016): an arena banner, the avatar in a gold ring
           overlapping it, the name in the display face. -->
      <div class="panel overflow-hidden">
        <div
          class="arena-surface relative h-24 overflow-hidden border-b border-default sm:h-28"
          aria-hidden="true"
        >
          <LayoutArcaneRings class="absolute -top-32 -right-10 size-80 sm:right-10" />
          <div class="gold-hairline absolute inset-x-0 -bottom-px" />
        </div>
        <div class="flex flex-col gap-4 px-5 pb-6 sm:flex-row sm:items-start sm:px-6">
          <ProfileAvatar
            size="3xl"
            :name="data.profile.displayName"
            :handle="data.profile.handle"
            class="relative -mt-12 size-20 shrink-0 text-3xl shadow-[0_0_0_6px_color-mix(in_oklab,var(--ui-secondary)_70%,transparent)] ring-4 ring-bg"
          />
          <LayoutPageHeader
            :title="data.profile.displayName"
            :description="t('sharing.handle', { handle: data.profile.handle })"
            class="min-w-0 flex-1 sm:pt-4"
          >
            <p
              v-if="data.profile.bio"
              class="mt-3 max-w-prose text-sm leading-6 text-default"
            >
              {{ data.profile.bio }}
            </p>
          </LayoutPageHeader>
        </div>
      </div>

      <!-- The owner sees their own profile through the visitor's lens —
           say so, so private items (badged below) aren't mistaken for shared. -->
      <UAlert
        v-if="data.viewer.isOwner"
        color="info"
        variant="subtle"
        icon="i-lucide-eye"
        :title="t('players.profile.ownerPreview')"
      >
        <template #actions>
          <UButton
            :label="t('players.profile.manageVisibility')"
            color="neutral"
            variant="outline"
            size="sm"
            to="/profile"
          />
        </template>
      </UAlert>

      <LayoutEmptyState
        v-if="isEmpty && data.viewer.isOwner"
        icon="i-lucide-eye-off"
        :title="t('players.profile.ownerEmpty')"
        :description="t('players.profile.ownerEmptyDescription')"
      >
        <template #actions>
          <UButton
            :label="t('players.profile.manageVisibility')"
            color="neutral"
            variant="outline"
            size="sm"
            to="/profile"
          />
        </template>
      </LayoutEmptyState>

      <LayoutEmptyState
        v-else-if="isEmpty"
        icon="i-lucide-eye-off"
        :title="t('players.profile.empty')"
      />

      <template v-else>
        <section
          v-if="data.decks.length > 0"
          class="space-y-3"
        >
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('players.profile.decks') }}
          </h2>
          <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <li
              v-for="deck in data.decks"
              :key="deck.id"
              class="group panel relative flex gap-4 p-4 transition-[translate,box-shadow,border-color] duration-200 ease-out-expo hover:border-primary/40 hover:shadow-lift motion-safe:hover:-translate-y-0.5"
            >
              <!-- Decorative cover (#29), fanned out like the owner's deck
                   list (ADR 0016); the stretched deck link covers the tile
                   (#134). -->
              <div
                aria-hidden="true"
                class="deck-fan shrink-0 self-start"
              >
                <span class="fan-card card-back" />
                <span class="fan-card card-back" />
                <CardThumb
                  size="lg"
                  class="fan-cover"
                  :src="deck.cover?.imageSmall"
                  :src-large="deck.cover?.imageLarge"
                  :alt="deck.cover ? cardName(deck.cover) : deck.name"
                  :no-image-label="deck.cover ? t('card.noImage') : t('players.profile.emptyDeckCover')"
                />
              </div>
              <div class="min-w-0 flex-1">
                <NuxtLink
                  :to="`/players/${handle}/decks/${deck.id}`"
                  class="stretched-link block min-w-0 rounded-sm"
                >
                  <h3 class="line-clamp-2 break-words text-base font-semibold text-highlighted transition-colors group-hover:text-primary">
                    {{ deck.name }}
                  </h3>
                </NuxtLink>
                <p class="mt-1 text-xs text-muted">
                  {{ count('players.cardCount', deck.cardCount) }}
                </p>
                <SharingVisibilityBadge
                  v-if="data.viewer.isOwner"
                  class="mt-2"
                  :visibility="deck.visibility"
                />
              </div>
            </li>
          </ul>
        </section>

        <section
          v-if="data.collections.length > 0"
          class="space-y-3"
        >
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('players.profile.collections') }}
          </h2>
          <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <li
              v-for="collection in data.collections"
              :key="collection.id"
              class="group panel relative p-4 transition-[box-shadow,border-color] duration-200 hover:border-primary/40 hover:shadow-lift"
            >
              <NuxtLink
                :to="`/players/${handle}/collections/${collection.id}`"
                class="stretched-link block min-w-0 rounded-sm"
              >
                <h3 class="truncate text-base font-semibold text-highlighted transition-colors group-hover:text-primary">
                  {{ collection.name }}
                </h3>
              </NuxtLink>
              <p class="mt-1 text-xs text-muted">
                {{ count('players.cardCount', collection.cardCount) }}
              </p>
              <SharingVisibilityBadge
                v-if="data.viewer.isOwner"
                class="mt-2"
                :visibility="collection.visibility"
              />
            </li>
          </ul>
        </section>

        <section
          v-if="data.inventory.visible"
          class="panel p-4"
        >
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('players.profile.inventory') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ count('players.cardCount', data.inventory.cardCount) }}
          </p>
          <NuxtLink
            :to="`/players/${handle}/inventory`"
            class="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            {{ t('players.profile.viewInventory') }}
          </NuxtLink>
        </section>

        <section
          v-if="data.wishlist.visible"
          class="panel p-4"
        >
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('players.profile.wishlist') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ count('players.cardCount', data.wishlist.itemCount) }}
          </p>
          <ul
            v-if="wishlistItems.length > 0"
            class="mt-3 divide-y divide-default"
          >
            <li
              v-for="item in wishlistItems"
              :key="item.id"
              class="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span class="truncate text-highlighted">{{ cardName(item) }}</span>
              <span class="shrink-0 font-numeric font-semibold tracking-[0.04em] text-default tabular-nums">{{ item.quantity }}×</span>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>
