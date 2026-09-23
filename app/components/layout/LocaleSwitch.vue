<script setup lang="ts">
import { de, en } from '@nuxt/ui/locale'
import { isAppLocale } from '~~/shared/locale'

/**
 * Interface language picker (ADR 0014). `compact` is the small header
 * variant of the auth and public layouts; the full one sits in the profile
 * settings card. Emits `saved` after a successful change; a failed profile
 * update shows a toast and keeps the old language.
 */
const props = withDefaults(defineProps<{
  compact?: boolean
  /** Below `sm`, show only the flag (for crowded headers). */
  collapse?: boolean
  id?: string
}>(), {
  compact: false,
  collapse: false,
  id: undefined,
})

const emit = defineEmits<{
  saved: []
}>()

const { t } = useI18n()
const toast = useToast()
const { locale, change } = useUiLocale()

const locales = [de, en]

// `collapse`: below `sm` the trigger shrinks to the flag (the aria-label
// stays the accessible name and the open list shows the language names), so
// the public header still fits on a phone.
const COLLAPSED_UI = {
  base: 'max-sm:pe-2',
  value: 'max-sm:sr-only',
  trailing: 'max-sm:hidden',
}
const widthClass = computed(() => {
  if (!props.compact) {
    return 'w-48'
  }
  return props.collapse ? 'w-10 sm:w-36' : 'w-36'
})

const isSaving = ref(false)

async function onChange(value: string) {
  if (!isAppLocale(value) || value === locale.value || isSaving.value) {
    return
  }
  isSaving.value = true
  try {
    await change(value)
    emit('saved')
  }
  catch {
    toast.add({ title: t('app.localeSwitch.saveFailed'), color: 'error' })
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <ULocaleSelect
    :id="id"
    :model-value="locale"
    :locales="locales"
    :disabled="isSaving"
    :size="compact ? 'sm' : 'md'"
    :variant="compact ? 'ghost' : 'outline'"
    :aria-label="t('app.localeSwitch.label')"
    :class="widthClass"
    :ui="collapse ? COLLAPSED_UI : undefined"
    @update:model-value="onChange"
  />
</template>
