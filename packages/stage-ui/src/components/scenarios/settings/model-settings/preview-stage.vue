<script setup lang="ts">
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { storeToRefs } from 'pinia'
import { computed, provide, ref, useTemplateRef, watch } from 'vue'

import { useSettings, useSettingsStage } from '../../../../stores/settings'
import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from './runtime'

const emit = defineEmits<{
  (e: 'runtimeSnapshotChanged', value: ModelSettingsRuntimeSnapshot): void
}>()

const settingsStore = useSettings()
const stageRef = useTemplateRef('stageRef')
const componentState = ref<'pending' | 'loading' | 'mounted'>('pending')

const { currentRenderer } = storeToRefs(useSettingsStage())
provide('previewStage', true)

const {
  stageModelSelected,
  stageModelSelectedUrl,
  stageModelRenderer,
  themeColorsHue,
  themeColorsHueDynamic,

} = storeToRefs(settingsStore)
const {
  spinePremultipliedAlpha,
  spineDefaultMixDuration,
  spineIdleAnimationEnabled,
  spineMaxFps,
  spineRenderScale,
} = storeToRefs(settingsStore)

const runtimeSnapshot = computed<ModelSettingsRuntimeSnapshot>(() => {
  const hasModel = !!stageModelSelectedUrl.value

  const phase = resolveComponentStateToRuntimePhase(componentState.value, { hasModel })

  return createEmptyModelSettingsRuntimeSnapshot({
    renderer: 'live2d',
    phase,
    controlsLocked: hasModel ? phase !== 'mounted' : false,
    previewAvailable: hasModel,
    canCapturePreview: !!stageRef.value?.canvasElement(),
    updatedAt: Date.now(),
  })
})

watch(runtimeSnapshot, snapshot => emit('runtimeSnapshotChanged', snapshot), { immediate: true })

defineExpose({
  capturePreviewFrame: () => stageRef.value?.captureFrame(),
})
</script>

<template>
  <template v-if="currentRenderer">
    <component :is="currentRenderer.stage" ref="stageRef" v-model:state="componentState" />
  </template>
</template>
