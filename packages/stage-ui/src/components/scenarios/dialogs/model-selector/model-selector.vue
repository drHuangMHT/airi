<script setup lang="ts">
import type { DisplayModel } from '../../../../stores/display-models'

import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'

import { useSettingsStage } from '../../../../stores'

const props = defineProps<{
  selectedModel?: DisplayModel
}>()

const highlightDisplayModelCard = ref<string | undefined>(props.selectedModel?.id)
const stageSettings = useSettingsStage()
const { currentRenderer } = storeToRefs(stageSettings)

watch(() => props.selectedModel?.id, (modelId) => {
  highlightDisplayModelCard.value = modelId
}, { immediate: true })
</script>

<template>
  <div pt="4 sm:0" gap="4 sm:6" h-full flex flex-col>
    <div
      v-if="currentRenderer"
      class="flex-1 overflow-x-auto overflow-y-hidden md:flex-none sm:overflow-x-hidden sm:overflow-y-scroll" h-full
      w-full
    >
      <component :is="currentRenderer.modelSelector" />
    </div>
    <div v-else>
      No renderer selected
    </div>
  </div>
</template>
