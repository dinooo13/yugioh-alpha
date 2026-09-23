<script setup lang="ts">
import type { PublicProfileResponse, SharedWishlistResponse } from '~~/shared/sharing'
import { pluralize } from '~~/shared/plural'

definePageMeta({ layout: 'public' })

const route = useRoute()
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

useHead({
  title: computed(() => `${data.value?.profile.displayName ?? 'Profil'} – yugioh alpha`),
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
      <LayoutPageHeader
        :title="data.profile.displayName"
        :description="`@${data.profile.handle}`"
        class="rounded-md border border-gray-200 bg-white p-6"
      >
        <p
          v-if="data.profile.bio"
          class="mt-3 max-w-prose text-sm text-gray-700"
        >
          {{ data.profile.bio }}
        </p>
      </LayoutPageHeader>

      <!-- The owner sees their own profile through the visitor's lens —
           say so, so private items (badged below) aren't mistaken for shared. -->
      <UAlert
        v-if="data.viewer.isOwner"
        color="info"
        variant="subtle"
        icon="i-lucide-eye"
        title="Vorschau deines Profils – private Inhalte siehst nur du."
      >
        <template #actions>
          <UButton
            label="Sichtbarkeit verwalten"
            color="neutral"
            variant="outline"
            size="sm"
            to="/profil"
          />
        </template>
      </UAlert>

      <LayoutEmptyState
        v-if="isEmpty && data.viewer.isOwner"
        icon="i-lucide-eye-off"
        title="Du teilst aktuell nichts."
        description="Decks, Sammlungen, Inventar und Wunschliste sind privat, bis du sie teilst."
      >
        <template #actions>
          <UButton
            label="Sichtbarkeit verwalten"
            color="neutral"
            variant="outline"
            size="sm"
            to="/profil"
          />
        </template>
      </LayoutEmptyState>

      <LayoutEmptyState
        v-else-if="isEmpty"
        icon="i-lucide-eye-off"
        title="Dieses Profil teilt aktuell nichts."
      />

      <template v-else>
        <section
          v-if="data.decks.length > 0"
          class="space-y-3"
        >
          <h2 class="text-base font-semibold text-gray-900">
            Decks
          </h2>
          <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <li
              v-for="deck in data.decks"
              :key="deck.id"
              class="rounded-md border border-gray-200 bg-white p-4"
            >
              <NuxtLink
                :to="`/spieler/${handle}/decks/${deck.id}`"
                class="min-w-0"
              >
                <h3 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
                  {{ deck.name }}
                </h3>
              </NuxtLink>
              <p class="mt-1 text-xs text-gray-500">
                {{ pluralize(deck.cardCount, 'Karte', 'Karten') }}
              </p>
              <SharingVisibilityBadge
                v-if="data.viewer.isOwner"
                class="mt-2"
                :visibility="deck.visibility"
              />
            </li>
          </ul>
        </section>

        <section
          v-if="data.collections.length > 0"
          class="space-y-3"
        >
          <h2 class="text-base font-semibold text-gray-900">
            Sammlungen
          </h2>
          <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <li
              v-for="collection in data.collections"
              :key="collection.id"
              class="rounded-md border border-gray-200 bg-white p-4"
            >
              <NuxtLink
                :to="`/spieler/${handle}/sammlungen/${collection.id}`"
                class="min-w-0"
              >
                <h3 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
                  {{ collection.name }}
                </h3>
              </NuxtLink>
              <p class="mt-1 text-xs text-gray-500">
                {{ pluralize(collection.cardCount, 'Karte', 'Karten') }}
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
          class="rounded-md border border-gray-200 bg-white p-4"
        >
          <h2 class="text-base font-semibold text-gray-900">
            Inventar
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            {{ pluralize(data.inventory.cardCount, 'Karte', 'Karten') }}
          </p>
          <NuxtLink
            :to="`/spieler/${handle}/inventar`"
            class="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            Inventar ansehen
          </NuxtLink>
        </section>

        <section
          v-if="data.wishlist.visible"
          class="rounded-md border border-gray-200 bg-white p-4"
        >
          <h2 class="text-base font-semibold text-gray-900">
            Wunschliste
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            {{ pluralize(data.wishlist.itemCount, 'Karte', 'Karten') }}
          </p>
          <ul
            v-if="wishlistItems.length > 0"
            class="mt-3 divide-y divide-gray-100"
          >
            <li
              v-for="item in wishlistItems"
              :key="item.id"
              class="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span class="truncate text-gray-900">{{ item.name }}</span>
              <span class="shrink-0 font-semibold tabular-nums text-gray-700">{{ item.quantity }}×</span>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>
