<script setup lang="ts">
import type { OwnProfile, Visibility } from '~~/shared/sharing'

useHead({ title: 'Profil – yugioh alpha' })

const { data: profile, pending, error } = await useFetch<OwnProfile>('/api/profile', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

function onSaved(updated: OwnProfile) {
  profile.value = updated
}

const isShareOpen = ref(false)

function onShareUpdated(visibility: Visibility) {
  if (profile.value) {
    profile.value = { ...profile.value, inventoryVisibility: visibility }
  }
}

const isSavingWishlistVisibility = ref(false)

async function setWishlistVisibility(makePublic: boolean) {
  if (isSavingWishlistVisibility.value || !profile.value) {
    return
  }

  const visibility = makePublic ? 'public' : 'private'
  if (profile.value.wishlistVisibility === visibility) {
    return
  }

  isSavingWishlistVisibility.value = true
  try {
    profile.value = await $fetch<OwnProfile>('/api/profile/wishlist-visibility', {
      method: 'PUT',
      body: { visibility },
    })
  }
  finally {
    isSavingWishlistVisibility.value = false
  }
}

const wishlistPublic = computed({
  get: () => profile.value?.wishlistVisibility === 'public',
  set: (value: boolean) => setWishlistVisibility(value),
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <h1 class="text-2xl font-semibold text-gray-900">
      Profil
    </h1>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Profil konnte nicht geladen werden"
      :description="error.message"
    />

    <div
      v-else-if="pending && !profile"
      class="space-y-4"
    >
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="profile">
      <section class="rounded-md border border-gray-200 bg-white p-4">
        <ProfileForm
          :profile="profile"
          @saved="onSaved"
        />
      </section>

      <section class="rounded-md border border-gray-200 bg-white p-4">
        <NuxtLink
          :to="`/spieler/${profile.handle}`"
          class="text-sm font-medium text-primary hover:underline"
        >
          Öffentliches Profil ansehen
        </NuxtLink>
      </section>

      <section class="flex items-center justify-between gap-4 rounded-md border border-gray-200 bg-white p-4">
        <div>
          <h2 class="text-base font-semibold text-gray-900">
            Inventar teilen
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            Alle Karten – teile dein gesamtes Inventar mit anderen Spielern.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <SharingVisibilityBadge
            :visibility="profile.inventoryVisibility"
            hide-private
          />
          <UButton
            icon="i-lucide-share-2"
            label="Teilen"
            color="neutral"
            variant="outline"
            @click="() => { isShareOpen = true }"
          />
        </div>
      </section>

      <section class="flex items-center justify-between gap-4 rounded-md border border-gray-200 bg-white p-4">
        <div>
          <h2 class="text-base font-semibold text-gray-900">
            Wunschliste öffentlich zeigen
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            Andere Spieler können deine Wunschliste auf deinem Profil sehen.
          </p>
        </div>
        <USwitch
          v-model="wishlistPublic"
          :disabled="isSavingWishlistVisibility"
          aria-label="Wunschliste öffentlich zeigen"
        />
      </section>

      <SharingShareModal
        v-model:open="isShareOpen"
        resource-type="inventory"
        resource-id="me"
        resource-name="Alle Karten"
        :share-path="`/spieler/${profile.handle}/inventar`"
        @updated="onShareUpdated"
      />
    </template>
  </div>
</template>
