<script setup lang="ts">
import { pluralize } from '~~/shared/plural'
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

const pageTitle = computed(() =>
  data.value ? `Inventar von ${data.value.owner.displayName}` : 'Inventar')

useHead({
  title: computed(() => `${pageTitle.value} – yugioh alpha`),
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
    <SharingNotFoundNotice v-if="error" />

    <template v-else-if="data">
      <div>
        <LayoutBackLink
          :to="`/spieler/${route.params.handle}`"
          label="Zurück zum Profil"
        />
      </div>

      <LayoutPageHeader
        :title="pageTitle"
        :description="pluralize(data.total, 'Karte', 'Karten')"
      />

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
