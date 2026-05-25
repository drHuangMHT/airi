<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useWheelAdjust } from '../../../composables/useWheelAdjust'
import { TextTitleDescription } from '../../typography'
import { Range } from '../range'

const props = withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  label?: string
  description?: string
  handleWheel?: boolean
  formatValue?: (value: number) => string
  as?: 'label' | 'div'
}>(), {
  as: 'label',
  handleWheel: false,
  min: 0,
  max: 1,
  step: 0.01,
})

const modelValue = defineModel<number>({ required: true })
const numericInput = useTemplateRef('numericInput')
useWheelAdjust(props, modelValue, numericInput)
</script>

<template>
  <props.as :class="['flex flex-col gap-4']">
    <div flex flex-row items-center justify-between gap-2>
      <slot name="label">
        <TextTitleDescription :label="props.label" :description="props.description" />
      </slot>
      <span ref="numericInput" font-mono hover:cursor-ns-resize>{{ props.formatValue?.(modelValue) ?? modelValue }}</span>
    </div>
    <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
      <Range
        v-model="modelValue"
        v-bind="{ min, max, step }"
        :class="['w-full']"
      />
    </div>
  </props.as>
</template>
