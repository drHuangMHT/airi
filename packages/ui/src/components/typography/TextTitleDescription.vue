<script setup lang="ts">
const props = defineProps<{ label?: string, description?: string }>()
</script>

<template>
  <div class="flex-1">
    <div :class="['font-medium', props.description ? 'text-sm' : 'text-md']">
      {{ props.label }}
    </div>
    <div v-if="props.description != null" class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ props.description }}
    </div>
  </div>
</template>
