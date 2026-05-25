<script setup lang="ts">
const props = defineProps<{ label?: string, description?: string }>()
</script>

<template>
  <div class="flex-1">
    <div class="flex items-center gap-1 text-sm font-medium">
      {{ props.label }}
    </div>
    <div class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ props.description }}
    </div>
  </div>
</template>
