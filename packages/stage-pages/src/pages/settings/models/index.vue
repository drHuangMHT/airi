<script setup lang="ts">
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings'

import ModelSettingsPanel from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/panel.vue'
import ModelSettingsPreviewStage from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/preview-stage.vue'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { createEmptyModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { Vibrant } from 'node-vibrant/browser'
import { ref, useTemplateRef } from 'vue'

const palette = ref<string[]>([])

const previewStageRef = useTemplateRef('previewStageRef')
const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())
const renderCanvas = ref(!isStageTamagotchi())

async function extractColorsFromModel() {
  renderCanvas.value = true
  const frame = await previewStageRef.value?.capturePreviewFrame()
  if (!frame) {
    console.error('No frame captured')
    return
  }

  const frameUrl = URL.createObjectURL(frame)
  try {
    const vibrant = new Vibrant(frameUrl)
    const paletteFromVibrant = await vibrant.getPalette()
    palette.value = Object.values(paletteFromVibrant).map(color => color?.hex).filter(it => typeof it === 'string')
  }
  finally {
    URL.revokeObjectURL(frameUrl)
  }
}

function handleRuntimeSnapshotChanged(nextSnapshot: ModelSettingsRuntimeSnapshot) {
  runtimeSnapshot.value = nextSnapshot
}
</script>

<template>
  <section p-4 style="height: calc(100vh - 3rem)">
    <ModelSettingsPanel
      :palette="palette"
      :runtime-snapshot="runtimeSnapshot"
      settings-class="w-100% md:w-40% lg:w-40% xl:w-25% 2xl:w-30% h-full overflow-y-scroll relative"
      @extract-colors-from-model="extractColorsFromModel"
    />
    <div v-if="renderCanvas">
      <ModelSettingsPreviewStage
        ref="previewStageRef"
        @runtime-snapshot-changed="handleRuntimeSnapshotChanged"
      />
    </div>
  </section>

  <div
    v-motion
    text="neutral-200/50 dark:neutral-600/20" pointer-events-none
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, y: 15 }"
    :enter="{ scale: 1, opacity: 1, y: 0 }"
    :duration="500"
    size-60
    flex items-center justify-center
  >
    <div text="60" i-solar:people-nearby-bold-duotone />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.models.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.models.description
  icon: i-solar:people-nearby-bold-duotone
  settingsEntry: true
  order: 4
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
