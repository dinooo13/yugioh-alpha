<script setup lang="ts">
import type { UserSearchItem } from '~~/shared/sharing'

const emit = defineEmits<{
  select: [userId: string]
}>()

const { t } = useI18n()
const apiError = useApiError()

const searchInput = ref('')
const debouncedSearch = ref('')
const results = ref<UserSearchItem[]>([])
const isSearching = ref(false)
const hasSearched = ref(false)
const errorMessage = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = value.trim()
  }, 300)
})

// The picker only calls the search endpoint from 2 characters on — the same
// floor the server enforces (server/utils/profiles.ts searchUsers), so an
// empty/near-empty query never triggers a request or a "no results" flash.
watch(debouncedSearch, async (term) => {
  if (term.length < 2) {
    results.value = []
    hasSearched.value = false
    return
  }

  isSearching.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ items: UserSearchItem[] }>('/api/users/search', {
      query: { q: term },
    })
    results.value = response.items
  }
  catch (error) {
    results.value = []
    errorMessage.value = apiError(error, 'sharing.userPicker.loadFailed')
  }
  finally {
    isSearching.value = false
    hasSearched.value = true
  }
})

function select(item: UserSearchItem) {
  emit('select', item.userId)
  searchInput.value = ''
  debouncedSearch.value = ''
  results.value = []
  hasSearched.value = false
}
</script>

<template>
  <div class="space-y-2">
    <UInput
      v-model="searchInput"
      icon="i-lucide-search"
      :placeholder="t('sharing.userPicker.placeholder')"
      :aria-label="t('sharing.userPicker.label')"
      autofocus
    />

    <ul
      v-if="results.length > 0"
      class="divide-y divide-default rounded-md border border-default bg-default"
    >
      <li
        v-for="item in results"
        :key="item.userId"
        class="flex items-center justify-between gap-2 px-3 py-2"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ item.displayName }}
          </p>
          <p class="truncate text-xs text-muted">
            {{ t('sharing.handle', { handle: item.handle }) }}
          </p>
        </div>
        <UButton
          size="xs"
          :label="t('common.add')"
          class="tap-target"
          @click="select(item)"
        />
      </li>
    </ul>

    <p
      v-else-if="hasSearched && !isSearching && debouncedSearch.length >= 2"
      class="text-sm text-muted"
    >
      {{ t('sharing.userPicker.noResults') }}
    </p>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
