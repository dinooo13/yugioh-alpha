<script setup lang="ts">
import type { RuleSet } from '~~/shared/rule-formats'

interface RuleFormatDetail {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  rules: RuleSet
  cardNames: Record<string, string>
  createdAt: string
  updatedAt: string
}

const route = useRoute()
const toast = useToast()
const formatId = computed(() => String(route.params.id ?? ''))
const errorMessage = ref('')

const { t, locale } = useI18n()
const apiError = useApiError()
const cloneFormatRequest = useFormatClone()
const { formatName, formatDescription, localizedRules } = useFormatLabel()

const { data: format, error } = await useFetch<RuleFormatDetail>(() => `/api/formats/${formatId.value}`, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

usePageTitle(() => (format.value ? formatName(format.value) : t('formats.detail.fallbackTitle')))

// A built-in format is shown in the interface language (name, description,
// rule labels); a user's own format as it is.
const editorValues = computed(() => {
  const current = format.value
  if (!current || !current.isBuiltin) {
    return current
  }
  return {
    ...current,
    name: formatName(current),
    description: formatDescription(current),
    rules: localizedRules(current, current.rules),
  }
})

// The editor copies its initial values once; a built-in's translated text
// follows a language switch by re-mounting it.
const editorKey = computed(() => (format.value?.isBuiltin ? `${format.value.id}-${locale.value}` : format.value?.id))

const loadErrorDescription = computed(() => (error.value ? apiError(error.value, 'formats.detail.loadFailedDescription') : undefined))

async function onSaved(saved: { id: string, name: string }) {
  toast.add({ title: t('formats.toast.saved', { name: saved.name }), color: 'success' })
  await navigateTo('/formats')
}

async function cloneFormat() {
  if (!format.value) {
    return
  }

  errorMessage.value = ''
  try {
    const copy = await cloneFormatRequest(format.value)
    toast.add({ title: t('formats.toast.created', { name: copy.name }), color: 'success' })
    await navigateTo(`/formats/${copy.id}`)
  }
  catch (requestError) {
    errorMessage.value = apiError(requestError, 'formats.errors.cloneFailed')
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <LayoutBackLink
        to="/formats"
        :label="t('formats.back')"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="t('formats.detail.loadFailed')"
      :description="loadErrorDescription"
    />

    <template v-else-if="format && editorValues">
      <LayoutPageHeader
        :title="editorValues.name"
        :description="format.isBuiltin ? t('formats.detail.builtinHint') : t('formats.detail.ownHint')"
        truncate
      >
        <template
          v-if="format.isBuiltin"
          #actions
        >
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            :label="t('formats.list.clone')"
            @click="cloneFormat"
          />
        </template>
      </LayoutPageHeader>

      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <FormatsRuleFormatEditor
        :key="editorKey"
        :initial-values="editorValues"
        :readonly="format.isBuiltin"
        @saved="onSaved"
      />
    </template>
  </div>
</template>
