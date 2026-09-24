<script setup lang="ts">
usePageTitle('formats.new.title')

const { t } = useI18n()
const toast = useToast()

async function onSaved(format: { id: string, name: string }) {
  toast.add({ title: t('formats.toast.saved', { name: format.name }), color: 'success' })
  await navigateTo('/formats')
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        to="/formats"
        :label="t('formats.back')"
      />
      <LayoutPageHeader
        :title="t('formats.new.title')"
        :description="t('formats.new.description')"
      />
    </div>

    <FormatsRuleFormatEditor @saved="onSaved" />
  </div>
</template>
