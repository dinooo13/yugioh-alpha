<script setup lang="ts">
import type { PublicProfileResponse } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()
const handle = computed(() => String(route.params.handle ?? ''))

const { data, error } = await useFetch<PublicProfileResponse>(
  () => `/api/profiles/${handle.value}`,
  {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  },
)

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
      <header class="rounded-md border border-gray-200 bg-white p-6">
        <h1 class="text-2xl font-semibold text-gray-900">
          {{ data.profile.displayName }}
        </h1>
        <p class="text-sm text-gray-500">
          @{{ data.profile.handle }}
        </p>
        <p
          v-if="data.profile.bio"
          class="mt-3 max-w-prose text-sm text-gray-700"
        >
          {{ data.profile.bio }}
        </p>
      </header>

      <p
        v-if="isEmpty"
        class="rounded-md border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500"
      >
        Dieses Profil teilt aktuell nichts.
      </p>

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
                {{ deck.cardCount }} Karten
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
                {{ collection.cardCount }} Karten
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
            {{ data.inventory.cardCount }} Karten
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
            {{ data.wishlist.itemCount }} Karten
          </p>
        </section>
      </template>
    </template>
  </div>
</template>
