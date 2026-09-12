<script setup lang="ts">
import type { SharedCardListResponse } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()

const search = ref('')
const sort = ref<'name' | '-name' | 'quantity'>('name')
const page = ref(1)

const query = computed(() => ({
  token: route.query.token || undefined,
  q: search.value || undefined,
  sort: sort.value,
  page: page.value,
  pageSize: 24,
}))

const { data, pending, error } = await useFetch<SharedCardListResponse>(
  () => `/api/profiles/${route.params.handle}/inventory`,
  {
    query,
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    watch: [query],
  },
)

useHead({
  title: computed(() => `${data.value?.source.name ?? 'Inventar'} – yugioh alpha`),
  meta: [
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ],
})

function onSearch(value: string) {
  search.value = value
  page.value = 1
}
function onSort(value: 'name' | '-name' | 'quantity') {
  sort.value = value
  page.value = 1
}
function onPage(value: number) {
  page.value = value
}
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
      <div>
        <NuxtLink
          :to="`/spieler/${route.params.handle}`"
          class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <UIcon
            name="i-lucide-arrow-left"
            class="size-4"
          />
          Zurück zum Profil
        </NuxtLink>
      </div>

      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          {{ data.source.name }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          Geteilt von {{ data.owner.displayName }} · {{ data.total }} Karten
        </p>
      </div>

      <SharingSharedCardList
        :items="data.items"
        :total="data.total"
        :page="data.page"
        :page-size="data.pageSize"
        :pending="pending"
        @update:search="onSearch"
        @update:sort="onSort"
        @update:page="onPage"
      />
    </template>
  </div>
</template>
