<script setup lang="ts">
import { getAuthSession } from '~/utils/session'

// Slim, session-optional shell for /players/** (Phase 6 shared views). Unlike
// `default.vue` this never fetches `/api/collections` or renders the owner
// sidebar — both would be meaningless (and 401-noisy) for an anonymous
// visitor. A session only changes the right-hand actions.
const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

// The "Mein Profil" avatar (#50). Anonymous visitors have no profile, so
// the request only runs with a session.
const { data: ownProfile, execute: loadOwnProfile } = await useOwnProfile({ immediate: Boolean(session.value) })

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
  if (session.value && !ownProfile.value) {
    await loadOwnProfile()
  }
})

const { t } = useI18n()
const route = useRoute()
// Preserved across the login round-trip so a signed-out visitor lands back
// on the shared link they came from (§4.2 #19) instead of the dashboard.
const loginTarget = computed(() => ({ path: '/login', query: { redirect: route.fullPath } }))
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <LayoutSkipLink />

    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <NuxtLink
          :to="session ? '/' : '/login'"
          class="flex items-center gap-2.5"
        >
          <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            Y
          </div>
          <span class="whitespace-nowrap text-base font-semibold text-gray-900">yugioh alpha</span>
        </NuxtLink>

        <div class="flex items-center gap-2">
          <LayoutLocaleSwitch
            compact
            collapse
          />
          <template v-if="session">
            <UButton
              :label="t('app.publicHeader.myProfile')"
              :aria-label="t('app.publicHeader.myProfile')"
              :icon="ownProfile ? undefined : 'i-lucide-user'"
              :ui="{ label: 'hidden sm:inline' }"
              color="neutral"
              variant="ghost"
              to="/profile"
            >
              <template
                v-if="ownProfile"
                #leading
              >
                <ProfileAvatar
                  size="2xs"
                  :name="ownProfile.displayName"
                  :handle="ownProfile.handle"
                />
              </template>
            </UButton>
            <UButton
              :label="t('app.publicHeader.toApp')"
              icon="i-lucide-arrow-right"
              variant="outline"
              color="neutral"
              to="/"
            />
          </template>
          <UButton
            v-else
            :label="t('app.publicHeader.login')"
            icon="i-lucide-log-in"
            :to="loginTarget"
          />
        </div>
      </div>
    </header>

    <main
      id="main-content"
      tabindex="-1"
      class="mx-auto max-w-5xl px-4 py-8 focus:outline-none sm:px-6"
    >
      <slot />
    </main>
  </div>
</template>
