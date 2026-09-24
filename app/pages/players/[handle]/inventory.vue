<script setup lang="ts">
import type { SharedInventoryResponse } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()
const { t } = useI18n()
const count = useCount()

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

const { data, pending, error } = await useFetch<SharedInventoryResponse>(
  () => `/api/profiles/${route.params.handle}/inventory`,
  {
    query,
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    watch: [query],
  },
)

const pageTitle = computed(() => data.value
  ? t('players.inventory.title', { name: data.value.owner.displayName })
  : t('players.inventory.fallbackTitle'))

usePageTitle(() => pageTitle.value)
useHead({
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
          :to="`/players/${route.params.handle}`"
          :label="t('players.backToProfile')"
        />
      </div>

      <LayoutPageHeader
        :title="pageTitle"
        :description="count('players.cardCount', data.total)"
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
