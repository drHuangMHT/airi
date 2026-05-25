<script setup lang="ts">
import { TextTitleDescription } from '@proj-airi/ui'
import { ref } from 'vue'

const props = defineProps<{
  label?: string
  description?: string
}>()

const expand = ref(false)
</script>

<template>
  <section @click="() => expand = !expand">
    <slot name="title">
      <TextTitleDescription :label="props.label" :description="props.description" />
    </slot>
  </section>
  <section v-if="expand">
    <slot name="expanded" />
  </section>
</template>
