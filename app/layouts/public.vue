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
  <div class="arena-canvas min-h-screen">
    <LayoutSkipLink />

    <header class="sticky top-0 z-30 border-b border-default bg-default/80 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <LayoutBrandMark
          :to="session ? '/' : '/login'"
          collapse
          class="shrink-0"
        />

        <div class="flex min-w-0 items-center gap-1 sm:gap-2">
          <LayoutLocaleSwitch
            compact
            collapse
          />
          <LayoutColorModeToggle />
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
      <div
        class="gold-hairline absolute inset-x-0 -bottom-px"
        aria-hidden="true"
      />
    </header>

    <main
      id="main-content"
      tabindex="-1"
      class="mx-auto max-w-5xl px-4 py-8 focus:outline-none sm:px-6"
    >
      <slot />
    </main>

    <!-- Trademark notice (ADR 0018) for anonymous visitors of shared views. -->
    <footer class="mx-auto max-w-5xl px-4 pb-8 text-center text-xs leading-5 text-muted sm:px-6">
      <p>{{ t('app.disclaimer') }}</p>
    </footer>
  </div>
</template>
