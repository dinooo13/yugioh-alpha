<script setup lang="ts">

interface PrintingOption {
  id: string
  setName: string
  rarity: string | null
}

interface CatalogCardOption {
  id: number
  name: string
  nameDe?: string | null
  type: string
  printings?: PrintingOption[]
}

interface OwnedCardInitialValues {
  id?: string
  catalogCardId: number
  printingId: string | null
  collectionId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  note: string | null
}

interface CollectionOption {
  id: string
  name: string
}

const props = defineProps<{
  open: boolean
  card: CatalogCardOption | null
  initialValues?: OwnedCardInitialValues | null
  collections?: CollectionOption[]
  presetCollectionId?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()
const apiError = useApiError()
const { languageItems, conditionItems, editionItems } = useCardOptionItems()

const noPrintingValue = '__no_printing__'
const noCollectionValue = '__no_collection__'

const form = reactive({
  quantity: 1,
  language: 'en',
  condition: 'near_mint',
  edition: 'unlimited',
  printingId: noPrintingValue,
  collectionId: noCollectionValue,
  note: '',
})

const isSubmitting = ref(false)
const errorMessage = ref('')

const isEditing = computed(() => Boolean(props.initialValues?.id))
const title = computed(() => isEditing.value ? t('inventory.addModal.editTitle') : t('inventory.addModal.addTitle'))
const printingItems = computed(() => [
  { label: t('inventory.addModal.noPrinting'), value: noPrintingValue },
  ...(props.card?.printings ?? []).map(printing => ({
    label: `${printing.id}${printing.setName ? ` · ${printing.setName}` : ''}${printing.rarity ? ` · ${printing.rarity}` : ''}`,
    value: printing.id,
  })),
])
const collectionItems = computed(() => [
  { label: t('inventory.noCollectionOption'), value: noCollectionValue },
  ...(props.collections ?? []).map(collection => ({
    label: collection.name,
    value: collection.id,
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
    form.collectionId = props.initialValues
      ? (props.initialValues.collectionId ?? noCollectionValue)
      : (props.presetCollectionId ?? noCollectionValue)
    form.note = props.initialValues?.note ?? ''
    errorMessage.value = ''
  },
  { immediate: true },
)

async function save() {
  const catalogCardId = props.initialValues?.catalogCardId ?? props.card?.id
  if (!catalogCardId) {
    errorMessage.value = t('inventory.addModal.noCard')
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  const payload = {
    catalog_card_id: catalogCardId,
    printing_id: form.printingId === noPrintingValue ? null : form.printingId,
    collection_id: form.collectionId === noCollectionValue ? null : form.collectionId,
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
    errorMessage.value = apiError(error, 'inventory.addModal.saveFailed')
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
            {{ cardName(card) }}
          </p>
          <p class="text-xs text-gray-500">
            {{ cardValue('type', card.type) }}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('card.field.quantity')">
            <UInput
              v-model.number="form.quantity"
              name="quantity"
              type="number"
              min="1"
            />
          </UFormField>

          <UFormField :label="t('card.field.printingLanguage')">
            <USelect
              v-model="form.language"
              :items="languageItems"
            />
          </UFormField>

          <UFormField :label="t('card.field.condition')">
            <USelect
              v-model="form.condition"
              :items="conditionItems"
            />
          </UFormField>

          <UFormField
            :label="t('card.field.edition')"
            :help="t('inventory.addModal.editionHelp')"
          >
            <USelect
              v-model="form.edition"
              :items="editionItems"
            />
          </UFormField>
        </div>

        <UFormField
          :label="t('card.field.printing')"
          :help="t('inventory.addModal.printingHelp')"
        >
          <USelect
            v-model="form.printingId"
            :items="printingItems"
          />
        </UFormField>

        <UFormField :label="t('card.field.collection')">
          <USelect
            v-model="form.collectionId"
            :items="collectionItems"
          />
        </UFormField>

        <UFormField :label="t('card.field.note')">
          <UTextarea
            v-model="form.note"
            name="note"
            :rows="3"
          />
        </UFormField>

        <!-- Form-level: the card is picked before this modal opens, so there is
             no card field a "Bitte zuerst eine Karte auswählen." could describe. -->
        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-red-600"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="() => { openProxy = false }"
          />
          <UButton
            type="submit"
            icon="i-lucide-save"
            :loading="isSubmitting"
            :label="isEditing ? t('common.save') : t('common.add')"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
