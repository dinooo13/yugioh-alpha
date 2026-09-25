<script setup lang="ts">
/**
 * The shared − / input / + control for a card quantity: the inventory's
 * detail panel (`InventoryOwnedCardEditor`), the add dialog
 * (`InventoryAddToInventoryModal`), the deck editor rows and the wishlist
 * rows (#144).
 *
 * - − and + emit the value ∓ 1 and are disabled only at `min` / `max`
 *   (and with `disabled`).
 * - A typed value is emitted on `change` (Enter, Tab, blur) when it is a
 *   whole number within `min`…`max`; anything else snaps back to
 *   `modelValue`. So does a value the parent didn't take over (e.g. a
 *   cancelled removal at 0).
 * - The inventory editor never disables it while it saves (disabling a
 *   focused button would drop keyboard focus to the page): it queues its
 *   writes instead. Callers whose writes send an absolute quantity (deck
 *   editor, wishlist) pass `disabled` while a write is in flight, so two
 *   writes never compute from the same stale value.
 */
import { MAX_OWNED_QUANTITY } from '~~/shared/inventory'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  size?: 'xs' | 'sm' | 'md'
  inputLabel: string
  decreaseLabel: string
  increaseLabel: string
  disabled?: boolean
  name?: string
}>(), {
  min: 0,
  max: MAX_OWNED_QUANTITY,
  size: 'xs',
  disabled: false,
  name: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const INPUT_WIDTH = { xs: 'w-12', sm: 'w-14', md: 'w-16' } as const

// Spin buttons hidden: − and + already step, and the arrows ate the narrow
// field's digits (as in the deck editor).
const inputUi = {
  base: 'text-center tabular-nums max-lg:min-h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
}

function snapBack(input: HTMLInputElement) {
  const expected = String(props.modelValue)
  if (input.value !== expected) {
    input.value = expected
  }
}

function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isInteger(value) || value < props.min || value > props.max) {
    snapBack(input)
    return
  }
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
  }
  // Resets the field unless the parent took the value over right away (it
  // may ask first, or refuse). The element stays, so focus does too.
  nextTick(() => snapBack(input))
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <UButton
      icon="i-lucide-minus"
      color="neutral"
      variant="outline"
      :size="size"
      class="tap-target"
      :disabled="disabled || modelValue <= min"
      :aria-label="decreaseLabel"
      @click="emit('update:modelValue', modelValue - 1)"
    />
    <UInput
      :model-value="modelValue"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      :name="name"
      :size="size"
      :class="INPUT_WIDTH[size]"
      :ui="inputUi"
      :disabled="disabled"
      :aria-label="inputLabel"
      @change="onChange"
    />
    <UButton
      icon="i-lucide-plus"
      color="neutral"
      variant="outline"
      :size="size"
      class="tap-target"
      :disabled="disabled || modelValue >= max"
      :aria-label="increaseLabel"
      @click="emit('update:modelValue', modelValue + 1)"
    />
  </div>
</template>
