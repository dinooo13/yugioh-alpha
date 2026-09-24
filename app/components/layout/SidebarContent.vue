<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'
import { getAuthSession } from '~/utils/session'

const { t } = useI18n()
const route = useRoute()

// A nav entry stays highlighted on its sub-pages — the Schnellerfassung at
// `/inventory/quick-entry`, the deck editor at `/decks/:id`, and the format editor
// at `/formats/:id` are child routes, not separate destinations, which an
// exact link match misses.
const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('app.nav.dashboard'), icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: t('app.nav.inventory'), icon: 'i-lucide-archive', to: '/inventory', active: route.path.startsWith('/inventory') },
  { label: t('app.nav.catalog'), icon: 'i-lucide-book-open', to: '/catalog' },
  { label: t('app.nav.decks'), icon: 'i-lucide-layers', to: '/decks', active: route.path.startsWith('/decks') },
  { label: t('app.nav.assistant'), icon: 'i-lucide-sparkles', to: '/assistant', active: route.path.startsWith('/assistant') },
  { label: t('app.nav.formats'), icon: 'i-lucide-scroll-text', to: '/formats', active: route.path.startsWith('/formats') },
  { label: t('app.nav.wishlist'), icon: 'i-lucide-heart', to: '/wishlist' },
  { label: t('app.nav.tournaments'), icon: 'i-lucide-trophy', to: '/tournaments', active: route.path.startsWith('/tournaments') },
])

const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
})

// The default layout only renders behind the auth middleware, so the
// profile request always has a session. Shared key: a rename on /profile
// shows here right away (#50).
const { data: ownProfile } = await useOwnProfile()

// Shown in the user block avatar/label: the profile's display name, else the
// account name, else the e-mail address (UX review #17: the name entered at
// registration used to never appear anywhere in the app).
const displayName = computed(() =>
  ownProfile.value?.displayName || session.value?.user.name || session.value?.user.email || '')
// Same seed as the public profile (the handle), so the avatar has the same
// colour here and on /players/<handle>.
const avatarSeed = computed(() => ownProfile.value?.handle ?? session.value?.user.email ?? '')

// The active item: a violet wash, a gold bar on the sidebar's edge and a
// gold icon — gold marks "where you are" (ADR 0016).
const NAV_UI = {
  link: [
    'py-2 px-3 gap-2.5 before:inset-x-0 focus-visible:before:outline-2 focus-visible:before:outline-focus',
    'data-active:text-highlighted data-active:before:bg-primary/15',
    'after:absolute after:-start-3 after:inset-y-1.5 after:w-0.5 after:rounded-full after:transition-colors data-active:after:bg-secondary',
  ].join(' '),
  linkLeadingIcon: 'size-[1.125rem] group-data-active:text-secondary',
}

async function onLogout() {
  await authClient.signOut()
  // Volle Navigation, damit kein gecachter Session-Zustand übrig bleibt.
  await navigateTo('/login', { external: true })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <nav class="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4">
      <UNavigationMenu
        orientation="vertical"
        :items="navItems"
        class="w-full"
        :ui="NAV_UI"
      />
    </nav>

    <div
      v-if="session"
      class="relative p-3"
    >
      <div
        class="gold-hairline absolute inset-x-3 top-0"
        aria-hidden="true"
      />
      <div class="flex items-center gap-3 py-1 ps-1.5">
        <ProfileAvatar
          :name="displayName"
          :handle="avatarSeed"
          size="md"
          class="shrink-0 ring-2 ring-secondary/60 ring-offset-2 ring-offset-island"
        />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ displayName }}</span>
        <LayoutColorModeToggle />
      </div>
      <UButton
        icon="i-lucide-user"
        :label="t('app.sidebar.profile')"
        to="/profile"
        variant="ghost"
        color="neutral"
        block
        class="mt-2 justify-start"
      />
      <UButton
        icon="i-lucide-log-out"
        :label="t('app.sidebar.logout')"
        variant="ghost"
        color="neutral"
        block
        class="mt-0.5 justify-start"
        @click="onLogout"
      />
    </div>
  </div>
</template>
