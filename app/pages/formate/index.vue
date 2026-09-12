<script setup lang="ts">
interface RuleFormatListItem {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  ruleCount: number
  updatedAt: string
}

useHead({ title: 'Formate – yugioh alpha' })

const toast = useToast()
const errorMessage = ref('')

const { data, pending, refresh } = await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const builtins = computed(() => (data.value?.items ?? []).filter(format => format.isBuiltin))
const ownFormats = computed(() => (data.value?.items ?? []).filter(format => !format.isBuiltin))

async function cloneFormat(format: RuleFormatListItem) {
  errorMessage.value = ''
  try {
    const copy = await $fetch<{ id: string, name: string }>(`/api/formats/${format.id}/clone`, { method: 'POST' })
    toast.add({ title: `"${copy.name}" erstellt`, color: 'success' })
    await navigateTo(`/formate/${copy.id}`)
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Das Format konnte nicht kopiert werden.'
  }
}

const { confirm } = useConfirm()

async function deleteFormat(format: RuleFormatListItem) {
  errorMessage.value = ''
  const confirmed = await confirm({
    title: 'Format löschen',
    description: `"${format.name}" wirklich löschen? Decks mit diesem Format behalten ihre Karten und stehen danach ohne Format da.`,
  })
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/formats/${format.id}`, { method: 'DELETE' })
    toast.add({ title: `"${format.name}" gelöscht`, color: 'success' })
    await refresh()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Das Format konnte nicht gelöscht werden.'
  }
}

function ruleCountLabel(format: RuleFormatListItem) {
  return `${format.ruleCount} Regel${format.ruleCount === 1 ? '' : 'n'}`
}
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Formate
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          Regelformate bestimmen, welche Karten und wie viele Kopien in einem Deck erlaubt sind.
        </p>
      </div>

      <UButton
        icon="i-lucide-plus"
        label="Neues Format"
        to="/formate/neu"
      />
    </div>

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
          Offizielle Formate
        </h2>
        <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <li
            v-for="format in builtins"
            :key="format.id"
            class="flex flex-col rounded-md border border-gray-200 bg-white p-4"
          >
            <div class="flex items-start justify-between gap-2">
              <NuxtLink
                :to="`/formate/${format.id}`"
                class="min-w-0 flex-1"
              >
                <h3 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
                  {{ format.name }}
                </h3>
              </NuxtLink>
              <UBadge
                color="neutral"
                variant="subtle"
                label="Offiziell"
              />
            </div>
            <p
              v-if="format.description"
              class="mt-1 line-clamp-3 text-sm text-gray-500"
            >
              {{ format.description }}
            </p>
            <p class="mt-3 text-xs text-gray-400">
              {{ ruleCountLabel(format) }}
            </p>
            <div class="mt-3 flex gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                label="Ansehen"
                :to="`/formate/${format.id}`"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                label="Klonen"
                :aria-label="`${format.name} klonen`"
                @click="cloneFormat(format)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-gray-900">
          Meine Formate
        </h2>

        <div
          v-if="ownFormats.length === 0"
          class="flex flex-col items-center rounded-md border border-gray-200 bg-white px-6 py-12 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <UIcon
              name="i-lucide-scroll-text"
              class="size-6"
            />
          </div>
          <h3 class="mt-4 text-base font-semibold text-gray-900">
            Noch keine eigenen Formate
          </h3>
          <p class="mt-1 max-w-sm text-sm text-gray-500">
            Lege ein eigenes Format mit deinen Hausregeln an oder klone ein offizielles Format.
          </p>
          <UButton
            icon="i-lucide-plus"
            label="Neues Format"
            class="mt-4"
            to="/formate/neu"
          />
        </div>

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
              :to="`/formate/${format.id}`"
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
                label="Bearbeiten"
                :to="`/formate/${format.id}`"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                label="Duplizieren"
                :aria-label="`${format.name} duplizieren`"
                @click="cloneFormat(format)"
              />
              <UButton
                size="xs"
                color="error"
                variant="outline"
                icon="i-lucide-trash-2"
                label="Löschen"
                :aria-label="`${format.name} löschen`"
                @click="deleteFormat(format)"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
