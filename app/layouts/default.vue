<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'
import { getAuthSession } from '~/utils/session'

const navItems: NavigationMenuItem[] = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Inventar', icon: 'i-lucide-archive', to: '/inventar' },
  { label: 'Decks', icon: 'i-lucide-layers', to: '/decks' },
  { label: 'Formate', icon: 'i-lucide-scroll-text', to: '/formate' },
  { label: 'Turniere', icon: 'i-lucide-trophy', to: '/turniere' },
]

const collections = [
  { name: 'Alle Karten', count: 1248, color: 'bg-violet-500' },
  { name: 'Box 1', count: 412, color: 'bg-emerald-500' },
  { name: 'Box 2', count: 367, color: 'bg-sky-500' },
  { name: 'Binder', count: 289, color: 'bg-amber-500' },
  { name: 'Trade Pile', count: 64, color: 'bg-rose-500' },
]

const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
})

async function onLogout() {
  await authClient.signOut()
  // Volle Navigation, damit kein gecachter Session-Zustand übrig bleibt.
  await navigateTo('/login', { external: true })
}
</script>

<template>
  <div class="flex min-h-screen bg-gray-50">
    <aside class="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div class="flex items-center gap-2.5 px-5 py-5">
        <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
          Y
        </div>
        <span class="text-base font-semibold text-gray-900">yugioh alpha</span>
      </div>

      <nav class="px-3">
        <UNavigationMenu
          orientation="vertical"
          :items="navItems"
          class="w-full"
        />
      </nav>

      <div class="mt-6 flex-1 overflow-y-auto px-3">
        <p class="px-2.5 text-xs font-semibold tracking-wider text-gray-400">
          SAMMLUNGEN
        </p>
        <ul class="mt-2 space-y-0.5">
          <li
            v-for="collection in collections"
            :key="collection.name"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="collection.color"
              />
              <span class="truncate">{{ collection.name }}</span>
              <span class="ml-auto text-xs tabular-nums text-gray-400">{{ collection.count }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="border-t border-gray-200 p-3">
        <UButton
          icon="i-lucide-plus"
          label="Neue Sammlung"
          variant="ghost"
          color="neutral"
          block
          class="justify-start"
        />
      </div>

      <div
        v-if="session"
        class="border-t border-gray-200 p-3"
      >
        <div class="flex items-center gap-2.5 px-1 py-1">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
            {{ session.user.email.slice(0, 2).toUpperCase() }}
          </div>
          <span class="truncate text-sm text-gray-700">{{ session.user.email }}</span>
        </div>
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
    </aside>

    <main class="flex-1 p-8">
      <slot />
    </main>
  </div>
</template>
