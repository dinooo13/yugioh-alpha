<script setup lang="ts">
interface RuleFormatListItem {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  ruleCount: number
  updatedAt: string
}

usePageTitle('formats.list.title')

const { t } = useI18n()
const count = useCount()
const apiError = useApiError()
const cloneFormatRequest = useFormatClone()
const { formatName, formatDescription, sortFormats } = useFormatLabel()

const toast = useToast()
const errorMessage = ref('')

const { data, pending, refresh } = await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const builtins = computed(() => sortFormats(data.value?.items ?? []).filter(format => format.isBuiltin))
const ownFormats = computed(() => (data.value?.items ?? []).filter(format => !format.isBuiltin))

async function cloneFormat(format: RuleFormatListItem) {
  errorMessage.value = ''
  try {
    const copy = await cloneFormatRequest(format)
    toast.add({ title: t('formats.toast.created', { name: copy.name }), color: 'success' })
    await navigateTo(`/formats/${copy.id}`)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'formats.errors.cloneFailed')
  }
}

const { confirm } = useConfirm()

async function deleteFormat(format: RuleFormatListItem) {
  errorMessage.value = ''
  const confirmed = await confirm({
    title: t('formats.confirm.delete.title'),
    description: t('formats.confirm.delete.description', { name: format.name }),
  })
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/formats/${format.id}`, { method: 'DELETE' })
    toast.add({ title: t('formats.toast.deleted', { name: format.name }), color: 'success' })
    await refresh()
  }
  catch (error) {
    errorMessage.value = apiError(error, 'formats.errors.deleteFailed')
  }
}

function ruleCountLabel(format: RuleFormatListItem) {
  return count('formats.list.ruleCount', format.ruleCount)
}
</script>

<template>
  <div class="space-y-8">
    <LayoutPageHeader
      :title="t('formats.list.title')"
      :description="t('formats.list.description')"
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('formats.list.newFormat')"
          to="/formats/new"
        />
      </template>
    </LayoutPageHeader>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="pending"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-32 w-full"
      />
    </div>

    <template v-else>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-gray-900">
          {{ t('formats.list.official') }}
        </h2>
        <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <li
            v-for="format in builtins"
            :key="format.id"
            class="flex flex-col rounded-md border border-gray-200 bg-white p-4"
          >
            <div class="flex items-start justify-between gap-2">
              <NuxtLink
                :to="`/formats/${format.id}`"
                class="min-w-0 flex-1"
              >
                <h3 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
                  {{ formatName(format) }}
                </h3>
              </NuxtLink>
              <UBadge
                color="neutral"
                variant="subtle"
                :label="t('formats.list.officialBadge')"
              />
            </div>
            <p
              v-if="formatDescription(format)"
              class="mt-1 line-clamp-3 text-sm text-gray-500"
            >
              {{ formatDescription(format) }}
            </p>
            <p class="mt-3 text-xs text-gray-400">
              {{ ruleCountLabel(format) }}
            </p>
            <div class="mt-3 flex gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                :label="t('formats.list.view')"
                :to="`/formats/${format.id}`"
                class="tap-target"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                :label="t('formats.list.clone')"
                :aria-label="t('formats.list.cloneLabel', { name: formatName(format) })"
                class="tap-target"
                @click="cloneFormat(format)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-gray-900">
          {{ t('formats.list.mine') }}
        </h2>

        <LayoutEmptyState
          v-if="ownFormats.length === 0"
          icon="i-lucide-scroll-text"
          :title="t('formats.list.empty.title')"
          :description="t('formats.list.empty.description')"
          :heading-level="3"
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              :label="t('formats.list.newFormat')"
              to="/formats/new"
            />
          </template>
        </LayoutEmptyState>

        <ul
          v-else
          class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <li
            v-for="format in ownFormats"
            :key="format.id"
            class="flex flex-col rounded-md border border-gray-200 bg-white p-4"
          >
            <NuxtLink
              :to="`/formats/${format.id}`"
              class="min-w-0"
            >
              <h3 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
                {{ format.name }}
              </h3>
            </NuxtLink>
            <p
              v-if="format.description"
              class="mt-1 line-clamp-3 text-sm text-gray-500"
            >
              {{ format.description }}
            </p>
            <p class="mt-3 text-xs text-gray-400">
              {{ ruleCountLabel(format) }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-pencil"
                :label="t('formats.list.edit')"
                :to="`/formats/${format.id}`"
                class="tap-target"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                :label="t('formats.list.duplicate')"
                :aria-label="t('formats.list.duplicateLabel', { name: format.name })"
                class="tap-target"
                @click="cloneFormat(format)"
              />
              <UButton
                size="xs"
                color="error"
                variant="outline"
                icon="i-lucide-trash-2"
                :label="t('common.delete')"
                :aria-label="t('formats.list.deleteLabel', { name: format.name })"
                class="tap-target"
                @click="deleteFormat(format)"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
