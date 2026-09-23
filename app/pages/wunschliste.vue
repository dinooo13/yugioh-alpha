<script setup lang="ts">
import { pluralize } from '~~/shared/plural'
import type { WishlistItemView, WishlistResponse } from '~~/shared/sharing'

const PAGE_SIZE = 24

useHead({ title: 'Wunschliste – yugioh alpha' })

const toast = useToast()

const searchInput = ref('')
const debouncedSearch = ref('')
const page = ref(1)

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = value.trim()
    page.value = 1
  }, 300)
})

const query = computed(() => ({
  q: debouncedSearch.value || undefined,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

const { data, pending, refresh } = await useFetch<WishlistResponse>('/api/wishlist', {
  query,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
  watch: [query],
})

const { data: ownProfile } = await useOwnProfile()

const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

function onUpdated(updated: WishlistItemView) {
  if (!data.value) {
    return
  }
  data.value = {
    ...data.value,
    items: data.value.items.map(item => (item.id === updated.id ? updated : item)),
  }
}

async function onRemoved(id: string) {
  toast.add({ title: 'Von der Wunschliste entfernt', color: 'success' })
  if (!data.value) {
    return
  }
  data.value = {
    ...data.value,
    items: data.value.items.filter(item => item.id !== id),
    total: Math.max(0, data.value.total - 1),
  }
  // The removed row may have been the last one on the page — reconcile with
  // the server rather than leaving a stale empty page.
  if (data.value.items.length === 0 && page.value > 1) {
    page.value -= 1
  }
  else {
    await refresh()
  }
}

function previousPage() {
  page.value = Math.max(1, page.value - 1)
}
function nextPage() {
  page.value = Math.min(totalPages.value, page.value + 1)
}
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      title="Wunschliste"
      :description="pluralize(total, 'Karte', 'Karten')"
    >
      <template #actions>
        <SharingVisibilityBadge :visibility="ownProfile?.wishlistVisibility ?? null" />
        <NuxtLink
          to="/profil#wunschliste"
          class="text-sm font-medium text-primary hover:underline"
        >
          Sichtbarkeit ändern
        </NuxtLink>
      </template>
    </LayoutPageHeader>

    <UInput
      v-model="searchInput"
      icon="i-lucide-search"
      placeholder="Wunschliste durchsuchen..."
      aria-label="Wunschliste durchsuchen"
      class="w-full max-w-xl"
    />

    <div
      v-if="pending"
      class="space-y-2"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-20 w-full"
      />
    </div>

    <LayoutEmptyState
      v-else-if="items.length === 0"
      icon="i-lucide-heart"
      title="Noch keine Karten auf der Wunschliste."
      description="Füge Karten im Katalog zu deiner Wunschliste hinzu."
    >
      <template #actions>
        <UButton
          icon="i-lucide-book-open"
          label="Zum Katalog"
          to="/katalog"
        />
      </template>
    </LayoutEmptyState>

    <ul
      v-else
      class="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white"
    >
      <WishlistRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        @updated="onUpdated"
        @removed="onRemoved"
      />
    </ul>

    <div
      v-if="total > PAGE_SIZE"
      class="flex items-center justify-center gap-2"
    >
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        :disabled="page <= 1"
        aria-label="Vorherige Seite"
        @click="previousPage"
      />
      <span class="min-w-28 text-center text-sm text-gray-600">
        Seite {{ page }} / {{ totalPages }}
      </span>
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        :disabled="page >= totalPages"
        aria-label="Nächste Seite"
        @click="nextPage"
      />
    </div>
  </div>
</template>
