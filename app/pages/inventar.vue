<script setup lang="ts">
interface InventoryItem {
  id: string
  catalogCardId: number
  printingId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  note: string | null
  cardName: string
  cardType: string
  imageUrlSmall: string | null
  setName: string | null
  rarity: string | null
}

interface CatalogCard {
  id: number
  name: string
  type: string
  imageUrlSmall?: string | null
  printings?: Array<{
    id: string
    cardId: number
    setName: string
    rarity: string | null
  }>
}

useHead({ title: 'Inventar – yugioh alpha' })

const search = ref('')
const page = ref(1)
const pageSize = 20
const isPickerOpen = ref(false)
const isEntryOpen = ref(false)
const selectedCard = ref<CatalogCard | null>(null)
const editingItem = ref<InventoryItem | null>(null)
const errorMessage = ref('')

const { data, pending, refresh } = await useFetch<{ items: InventoryItem[], total: number }>('/api/inventory', {
  query: {
    q: search,
    page,
    pageSize,
  },
  default: () => ({ items: [], total: 0 }),
  watch: [search, page],
})

const items = computed(() => data.value.items)
const total = computed(() => data.value.total)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const editionLabels: Record<string, string> = {
  first: '1st',
  unlimited: 'Unlimited',
  limited: 'Limited',
}

const conditionLabels: Record<string, string> = {
  mint: 'M',
  near_mint: 'NM',
  excellent: 'EX',
  good: 'GD',
  light_played: 'LP',
  played: 'PL',
  poor: 'PO',
}

watch(search, () => {
  page.value = 1
})

function openAdd(card: CatalogCard) {
  selectedCard.value = card
  editingItem.value = null
  isPickerOpen.value = false
  isEntryOpen.value = true
}

function openEdit(item: InventoryItem) {
  selectedCard.value = {
    id: item.catalogCardId,
    name: item.cardName,
    type: item.cardType,
    imageUrlSmall: item.imageUrlSmall,
    printings: item.printingId
      ? [{ id: item.printingId, cardId: item.catalogCardId, setName: item.setName ?? '', rarity: item.rarity }]
      : [],
  }
  editingItem.value = item
  isEntryOpen.value = true
}

async function removeItem(item: InventoryItem) {
  errorMessage.value = ''
  const confirmed = window.confirm(`${item.cardName} aus dem Inventar entfernen?`)
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/inventory/${item.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Karte konnte nicht entfernt werden.'
  }
}

async function onSaved() {
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Inventar
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          Alle Karten, die du besitzt, mit Anzahl und Zustand.
        </p>
      </div>

      <UButton
        icon="i-lucide-plus"
        label="Karte hinzufügen"
        @click="() => { isPickerOpen = true }"
      />
    </div>

    <div class="flex max-w-xl">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Suche im Inventar..."
        aria-label="Inventar durchsuchen"
        class="w-full"
      />
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>

    <div class="overflow-hidden rounded-md border border-gray-200 bg-white">
      <div
        v-if="pending"
        class="p-6 text-sm text-gray-500"
      >
        Inventar wird geladen...
      </div>

      <div
        v-else-if="items.length === 0"
        class="flex flex-col items-center px-6 py-12 text-center"
      >
        <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <UIcon
            name="i-lucide-archive"
            class="size-6"
          />
        </div>
        <h2 class="mt-4 text-base font-semibold text-gray-900">
          Keine Karten im Inventar
        </h2>
        <p class="mt-1 max-w-sm text-sm text-gray-500">
          Suche eine Karte im Katalog und füge deine ersten Exemplare hinzu.
        </p>
        <UButton
          icon="i-lucide-plus"
          label="Karte hinzufügen"
          class="mt-4"
          @click="() => { isPickerOpen = true }"
        />
      </div>

      <table
        v-else
        class="w-full table-fixed divide-y divide-gray-200"
      >
        <thead class="bg-gray-50">
          <tr class="text-left text-xs font-semibold uppercase text-gray-500">
            <th class="w-16 px-4 py-3">
              Bild
            </th>
            <th class="px-4 py-3">
              Karte
            </th>
            <th class="w-20 px-4 py-3">
              Sprache
            </th>
            <th class="w-28 px-4 py-3">
              Edition
            </th>
            <th class="w-24 px-4 py-3">
              Zustand
            </th>
            <th class="w-20 px-4 py-3 text-right">
              Anzahl
            </th>
            <th class="w-24 px-4 py-3 text-right">
              Aktionen
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="item in items"
            :key="item.id"
            class="text-sm"
          >
            <td class="px-4 py-3">
              <img
                v-if="item.imageUrlSmall"
                :src="item.imageUrlSmall"
                :alt="item.cardName"
                class="h-14 w-10 rounded object-cover"
              >
              <div
                v-else
                class="flex h-14 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
              >
                —
              </div>
            </td>
            <td class="min-w-0 px-4 py-3">
              <div class="truncate font-medium text-gray-900">
                {{ item.cardName }}
              </div>
              <div class="truncate text-xs text-gray-500">
                {{ item.cardType }}<span v-if="item.setName"> · {{ item.setName }}</span>
              </div>
            </td>
            <td class="px-4 py-3 uppercase text-gray-700">
              {{ item.language }}
            </td>
            <td class="px-4 py-3 text-gray-700">
              {{ editionLabels[item.edition] ?? item.edition }}
            </td>
            <td class="px-4 py-3 text-gray-700">
              {{ conditionLabels[item.condition] ?? item.condition }}
            </td>
            <td class="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
              ×{{ item.quantity }}
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  aria-label="Karte bearbeiten"
                  @click="openEdit(item)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  aria-label="Karte entfernen"
                  @click="removeItem(item)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="total > pageSize"
      class="flex justify-end"
    >
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="pageSize"
        :page-count="pageCount"
      />
    </div>

    <UModal
      v-model:open="isPickerOpen"
      title="Karte aus dem Katalog wählen"
    >
      <template #body>
        <InventoryCatalogCardPicker @select="openAdd" />
      </template>
    </UModal>

    <InventoryAddToInventoryModal
      v-model:open="isEntryOpen"
      :card="selectedCard"
      :initial-values="editingItem && {
        id: editingItem.id,
        catalogCardId: editingItem.catalogCardId,
        printingId: editingItem.printingId,
        quantity: editingItem.quantity,
        language: editingItem.language,
        condition: editingItem.condition,
        edition: editingItem.edition,
        note: editingItem.note,
      }"
      @saved="onSaved"
    />
  </div>
</template>
