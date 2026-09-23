<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'
import { getAuthSession } from '~/utils/session'

const route = useRoute()

// A nav entry stays highlighted on its sub-pages — the Schnellerfassung at
// `/inventar/erfassen`, the deck editor at `/decks/:id`, and the format editor
// at `/formate/:id` are child routes, not separate destinations, which an
// exact link match misses.
const navItems = computed<NavigationMenuItem[]>(() => [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Inventar', icon: 'i-lucide-archive', to: '/inventar', active: route.path.startsWith('/inventar') },
  { label: 'Katalog', icon: 'i-lucide-book-open', to: '/katalog' },
  { label: 'Decks', icon: 'i-lucide-layers', to: '/decks', active: route.path.startsWith('/decks') },
  { label: 'Assistent', icon: 'i-lucide-sparkles', to: '/assistent', active: route.path.startsWith('/assistent') },
  { label: 'Formate', icon: 'i-lucide-scroll-text', to: '/formate', active: route.path.startsWith('/formate') },
  { label: 'Wunschliste', icon: 'i-lucide-heart', to: '/wunschliste' },
  { label: 'Turniere', icon: 'i-lucide-trophy', to: '/turniere', active: route.path.startsWith('/turniere') },
])

const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
})

// Shown in the user block avatar/label — falls back to the e-mail address
// only if a session was somehow created without a name (UX review #17: the
// name entered at registration used to never appear anywhere in the app).
const displayName = computed(() => session.value?.user.name || session.value?.user.email || '')
const avatarInitials = computed(() => displayName.value.slice(0, 2).toUpperCase())

async function onLogout() {
  await authClient.signOut()
  // Volle Navigation, damit kein gecachter Session-Zustand übrig bleibt.
  await navigateTo('/login', { external: true })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <nav class="px-3 pt-3">
      <UNavigationMenu
        orientation="vertical"
        :items="navItems"
        class="w-full"
      />
    </nav>

    <div class="flex-1" />

    <div
      v-if="session"
      class="border-t border-gray-200 p-3"
    >
      <div class="flex items-center gap-2.5 px-1 py-1">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
          {{ avatarInitials }}
        </div>
        <span class="truncate text-sm text-gray-700">{{ displayName }}</span>
      </div>
      <UButton
        icon="i-lucide-user"
        label="Profil"
        to="/profil"
        variant="ghost"
        color="neutral"
        block
        class="mt-1 justify-start"
      />
      <UButton
        icon="i-lucide-log-out"
        label="Abmelden"
        variant="ghost"
        color="neutral"
        block
        class="mt-1 justify-start"
        @click="onLogout"
      />
    </div>
  </div>
</template>
