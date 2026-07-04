<script setup lang="ts">
interface PrintingOption {
  id: string
  setName: string
  rarity: string | null
}

interface CatalogCardOption {
  id: number
  name: string
  type: string
  printings?: PrintingOption[]
}

interface OwnedCardInitialValues {
  id?: string
  catalogCardId: number
  printingId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  note: string | null
}

const props = defineProps<{
  open: boolean
  card: CatalogCardOption | null
  initialValues?: OwnedCardInitialValues | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const languageItems = [
  { label: 'EN', value: 'en' },
  { label: 'DE', value: 'de' },
  { label: 'FR', value: 'fr' },
  { label: 'IT', value: 'it' },
  { label: 'ES', value: 'es' },
  { label: 'PT', value: 'pt' },
  { label: 'JA', value: 'ja' },
  { label: 'KO', value: 'ko' },
]

const conditionItems = [
  { label: 'Mint', value: 'mint' },
  { label: 'Near Mint', value: 'near_mint' },
  { label: 'Excellent', value: 'excellent' },
  { label: 'Good', value: 'good' },
  { label: 'Light Played', value: 'light_played' },
  { label: 'Played', value: 'played' },
  { label: 'Poor', value: 'poor' },
]

const editionItems = [
  { label: '1st Edition', value: 'first' },
  { label: 'Unlimited', value: 'unlimited' },
  { label: 'Limited', value: 'limited' },
]

const noPrintingValue = '__no_printing__'

const form = reactive({
  quantity: 1,
  language: 'en',
  condition: 'near_mint',
  edition: 'unlimited',
  printingId: noPrintingValue,
  note: '',
})

const isSubmitting = ref(false)
const errorMessage = ref('')

const isEditing = computed(() => Boolean(props.initialValues?.id))
const title = computed(() => isEditing.value ? 'Karte bearbeiten' : 'Karte hinzufügen')
const printingItems = computed(() => [
  { label: 'Keine bestimmte Edition', value: noPrintingValue },
  ...(props.card?.printings ?? []).map(printing => ({
    label: `${printing.id}${printing.setName ? ` · ${printing.setName}` : ''}${printing.rarity ? ` · ${printing.rarity}` : ''}`,
    value: printing.id,
  })),
])

const openProxy = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

watch(
  () => [props.open, props.card?.id, props.initialValues?.id] as const,
  () => {
    if (!props.open) {
      return
    }

    form.quantity = props.initialValues?.quantity ?? 1
    form.language = props.initialValues?.language ?? 'en'
    form.condition = props.initialValues?.condition ?? 'near_mint'
    form.edition = props.initialValues?.edition ?? 'unlimited'
    form.printingId = props.initialValues?.printingId ?? noPrintingValue
    form.note = props.initialValues?.note ?? ''
    errorMessage.value = ''
  },
  { immediate: true },
)

async function save() {
  const catalogCardId = props.initialValues?.catalogCardId ?? props.card?.id
  if (!catalogCardId) {
    errorMessage.value = 'Bitte zuerst eine Karte auswählen.'
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  const payload = {
    catalog_card_id: catalogCardId,
    printing_id: form.printingId === noPrintingValue ? null : form.printingId,
    quantity: form.quantity,
    language: form.language,
    condition: form.condition,
    edition: form.edition,
    note: form.note || null,
  }

  try {
    if (props.initialValues?.id) {
      await $fetch(`/api/inventory/${props.initialValues.id}`, {
        method: 'PATCH',
        body: payload,
      })
    }
    else {
      await $fetch('/api/inventory', {
        method: 'POST',
        body: payload,
      })
    }

    emit('saved')
    openProxy.value = false
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Die Karte konnte nicht gespeichert werden.'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    :title="title"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="save"
      >
        <div v-if="card">
          <p class="text-sm font-medium text-gray-900">
            {{ card.name }}
          </p>
          <p class="text-xs text-gray-500">
            {{ card.type }}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Anzahl">
            <UInput
              v-model.number="form.quantity"
              name="quantity"
              type="number"
              min="1"
            />
          </UFormField>

          <UFormField label="Sprache">
            <USelect
              v-model="form.language"
              :items="languageItems"
            />
          </UFormField>

          <UFormField label="Zustand">
            <USelect
              v-model="form.condition"
              :items="conditionItems"
            />
          </UFormField>

          <UFormField label="Edition">
            <USelect
              v-model="form.edition"
              :items="editionItems"
            />
          </UFormField>
        </div>

        <UFormField label="Printing">
          <USelect
            v-model="form.printingId"
            :items="printingItems"
          />
        </UFormField>

        <UFormField label="Notiz">
          <UTextarea
            v-model="form.note"
            name="note"
            :rows="3"
          />
        </UFormField>

        <p
          v-if="errorMessage"
          class="text-sm text-red-600"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            label="Abbrechen"
            @click="() => { openProxy = false }"
          />
          <UButton
            type="submit"
            icon="i-lucide-save"
            :loading="isSubmitting"
            :label="isEditing ? 'Speichern' : 'Hinzufügen'"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
