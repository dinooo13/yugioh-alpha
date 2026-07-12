<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'
import { getAuthSession } from '~/utils/session'

interface CollectionItem {
  id: string
  name: string
  description: string | null
  cardCount: number
}

interface CollectionsResponse {
  items: CollectionItem[]
  allCount: number
}

const navItems: NavigationMenuItem[] = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Inventar', icon: 'i-lucide-archive', to: '/inventar' },
  { label: 'Decks', icon: 'i-lucide-layers', to: '/decks' },
  { label: 'Formate', icon: 'i-lucide-scroll-text', to: '/formate' },
  { label: 'Turniere', icon: 'i-lucide-trophy', to: '/turniere' },
]

// Deterministic cosmetic color per collection, since collections have no
// stored color attribute (see docs/adr/0002 – additive collection extension).
const dotColors = ['bg-violet-500', 'bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500', 'bg-fuchsia-500']
function dotColorFor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return dotColors[hash % dotColors.length]
}

const { data: collectionsData, refresh: refreshCollections } = await useFetch<CollectionsResponse>('/api/collections', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], allCount: 0 }),
})

const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
  await refreshCollections()
})

const route = useRoute()
const activeCollectionId = computed(() => {
  const value = route.query.collectionId
  return typeof value === 'string' ? value : null
})

const isFormOpen = ref(false)
const editingCollection = ref<CollectionItem | null>(null)

function openCreate() {
  editingCollection.value = null
  isFormOpen.value = true
}

function openRename(collection: CollectionItem) {
  editingCollection.value = collection
  isFormOpen.value = true
}

async function onCollectionSaved() {
  await refreshCollections()
}

async function onDelete(collection: CollectionItem) {
  const confirmed = window.confirm(
    `"${collection.name}" löschen? Die Karten bleiben erhalten und werden zu "Alle Karten".`,
  )
  if (!confirmed) {
    return
  }

  await $fetch(`/api/collections/${collection.id}`, { method: 'DELETE' })

  if (activeCollectionId.value === collection.id) {
    await navigateTo('/inventar')
  }

  await refreshCollections()
}

function menuItemsFor(collection: CollectionItem) {
  return [[
    {
      label: 'Umbenennen',
      icon: 'i-lucide-pencil',
      onSelect: () => openRename(collection),
    },
    {
      label: 'Löschen',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => onDelete(collection),
    },
  ]]
}

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
          <li>
            <NuxtLink
              to="/inventar"
              class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              :class="{ 'bg-gray-100 font-medium text-gray-900': !activeCollectionId }"
            >
              <span class="size-2 shrink-0 rounded-full bg-primary" />
              <span class="truncate">Alle Karten</span>
              <span class="ml-auto text-xs tabular-nums text-gray-400">{{ collectionsData.allCount }}</span>
            </NuxtLink>
          </li>
          <li
            v-for="collection in collectionsData.items"
            :key="collection.id"
            class="group flex items-center"
          >
            <NuxtLink
              :to="{ path: '/inventar', query: { collectionId: collection.id } }"
              class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              :class="{ 'bg-gray-100 font-medium text-gray-900': activeCollectionId === collection.id }"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="dotColorFor(collection.id)"
              />
              <span class="truncate">{{ collection.name }}</span>
              <span class="ml-auto text-xs tabular-nums text-gray-400">{{ collection.cardCount }}</span>
            </NuxtLink>
            <UDropdownMenu :items="menuItemsFor(collection)">
              <UButton
                icon="i-lucide-more-horizontal"
                color="neutral"
                variant="ghost"
                size="xs"
                class="shrink-0 opacity-0 group-hover:opacity-100"
                :aria-label="`Optionen für ${collection.name}`"
              />
            </UDropdownMenu>
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
          @click="openCreate"
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

    <CollectionsCollectionFormModal
      v-model:open="isFormOpen"
      :initial-values="editingCollection"
      @saved="onCollectionSaved"
    />
  </div>
</template>
