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
  defaultValue?: number
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
  <props.as :class="['flex flex-col gap-2']">
    <div flex>
      <slot name="label">
        <TextTitleDescription :label="props.label" :description="props.description" />
      </slot>
      <output ref="numericInput" m-l-a font-mono hover:cursor-ns-resize>{{ props.formatValue?.(modelValue) ?? modelValue }}</output>
      <button v-if="props.defaultValue != null" px-2 text-xs outline-none title="Reset value to default" @click="() => modelValue = props.defaultValue!">
        <div i-solar:restart-outline transform-scale-x--100 text="neutral-500 dark:neutral-400" />
      </button>
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
