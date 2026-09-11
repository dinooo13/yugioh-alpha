<script setup lang="ts">
interface CollectionBreakdown {
  collectionId: string | null
  collectionName: string | null
  quantity: number
}

interface SearchResultItem {
  catalogCardId: number
  name: string
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  totalQuantity: number
  collectionBreakdown?: CollectionBreakdown[]
}

const props = defineProps<{
  item: SearchResultItem
}>()

const breakdown = computed(() => props.item.collectionBreakdown ?? [])
const showInline = computed(() => breakdown.value.length <= 2)

function breakdownLabel(entry: CollectionBreakdown) {
  return entry.collectionId ? (entry.collectionName ?? 'Unbenannte Sammlung') : '(keine Sammlung)'
}

function breakdownKey(entry: CollectionBreakdown) {
  return entry.collectionId ?? '__none__'
}
</script>

<template>
  <div class="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <img
        v-if="item.imageSmall"
        :src="item.imageSmall"
        :alt="item.name"
        class="h-14 w-10 shrink-0 rounded object-cover"
      >
      <div
        v-else
        class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
      >
        —
      </div>
      <div class="min-w-0">
        <div class="truncate font-medium text-gray-900">
          {{ item.name }}
        </div>
        <div class="truncate text-xs text-gray-500">
          {{ item.type }}<span v-if="item.attribute"> · {{ item.attribute }}</span><span v-if="item.race"> · {{ item.race }}</span>
        </div>
      </div>
    </div>

    <div class="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 sm:w-24 sm:text-right">
      ×{{ item.totalQuantity }} ges.
    </div>

    <div class="flex flex-wrap items-center gap-1 sm:w-64 sm:justify-end">
      <template v-if="showInline">
        <UBadge
          v-for="entry in breakdown"
          :key="breakdownKey(entry)"
          color="neutral"
          variant="subtle"
        >
          {{ breakdownLabel(entry) }} ×{{ entry.quantity }}
        </UBadge>
        <span
          v-if="breakdown.length === 0"
          class="text-xs text-gray-400"
        >
          —
        </span>
      </template>
      <UPopover v-else>
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          trailing-icon="i-lucide-chevron-down"
          label="Aufschlüsselung"
        />
        <template #content>
          <div class="min-w-48 space-y-1 p-3">
            <div
              v-for="entry in breakdown"
              :key="breakdownKey(entry)"
              class="flex items-center justify-between gap-4 text-sm"
            >
              <span class="text-gray-700">{{ breakdownLabel(entry) }}</span>
              <span class="font-medium tabular-nums text-gray-900">×{{ entry.quantity }}</span>
            </div>
          </div>
        </template>
      </UPopover>
    </div>
  </div>
</template>
