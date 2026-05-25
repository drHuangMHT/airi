<script setup lang="ts">
import type {
  StageViewErrorPayload,
  StageViewPatch,
  StageViewSnapshotPayload,
} from '@proj-airi/stage-shared/godot-stage'

import type { DisplayModel } from '../../../../stores/display-models'
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import GodotSettings from './godot.vue'
import Live2DSettings from './live2d.vue'
import SpineSettings from './spine.vue'
import VRMSettings from './vrm.vue'

import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useSettings } from '../../../../stores/settings'
import { ModelSelectorDialog } from '../../dialogs/model-selector'

interface ModelSettingsPanelProps {
  palette: string[]
  settingsClass?: string | string[]
  allowExtractColors?: boolean
  runtimeSnapshot: ModelSettingsRuntimeSnapshot
  godotViewSnapshot?: StageViewSnapshotPayload | null
  godotViewError?: StageViewErrorPayload
  godotViewControlsLocked?: boolean
}

interface ModelSettingsPanelEmits {
  extractColorsFromModel: []
  patchGodotViewState: [patch: StageViewPatch]
}

const _props = withDefaults(defineProps<ModelSettingsPanelProps>(), {
  allowExtractColors: true,
  godotViewControlsLocked: true,
  godotViewSnapshot: null,
})

const emit = defineEmits<ModelSettingsPanelEmits>()

const { t } = useI18n()
const { localRenderer } = inject<{ localRenderer: string | undefined }>('local-renderer', { localRenderer: undefined })
const modelSelectorOpen = ref(false)
const settingsStore = useSettings()
const airiCardStore = useAiriCardStore()
const { stageModelSelectedDisplayModel, stageModelSelected } = storeToRefs(settingsStore)

async function handleModelPick(selectedModel: DisplayModel | undefined) {
  stageModelSelected.value = selectedModel?.id ?? ''
  airiCardStore.updateActiveCardDisplayModel(selectedModel?.id)
  await settingsStore.updateStageModel()
}
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-2',
      'z-10 overflow-y-scroll p-2',
      settingsClass,
    ]"
  >
    <Callout :label="t('settings.model-select.panel-callout.support-status-header')">
      <i18n-t keypath="settings.model-select.panel-callout.support-status" tag="p">
        <template #select-button>
          <strong>{{ t('settings.model-select.select-model.button') }}</strong>
        </template>
        <template #zip>
          <code>.zip</code>
        </template>
        <template #vrm>
          <code>.vrm</code>
        </template>
      </i18n-t>
      <p>
        {{ t('settings.model-select.panel-callout.model-type-example') }}
      </p>
    </Callout>
    <div :class="['flex flex-wrap items-center gap-2']">
      <ModelSelectorDialog v-model:show="modelSelectorOpen" :selected-model="stageModelSelectedDisplayModel" @pick="handleModelPick">
        <Button variant="secondary">
          {{ t('settings.model-select.select-model.button') }}
        </Button>
      </ModelSelectorDialog>
      <slot name="actions" />
    </div>
    <Live2DSettings
      v-if="localRenderer === 'live2d'"
      :allow-extract-colors="allowExtractColors"
      :palette="palette"
      :runtime-snapshot="runtimeSnapshot"
      @extract-colors-from-model="emit('extractColorsFromModel')"
    />
    <VRMSettings
      v-if="localRenderer === 'vrm'"
      :allow-extract-colors="allowExtractColors"
      :palette="palette"
      :runtime-snapshot="runtimeSnapshot"
      @extract-colors-from-model="emit('extractColorsFromModel')"
    />
    <SpineSettings
      v-if="localRenderer === 'spine'"
      :allow-extract-colors="allowExtractColors"
      :palette="palette"
      :runtime-snapshot="runtimeSnapshot"
      @extract-colors-from-model="$emit('extractColorsFromModel')"
    />
    <GodotSettings
      v-if="localRenderer === 'godot'"
      :runtime-snapshot="runtimeSnapshot"
      :view-snapshot="godotViewSnapshot"
      :view-error="godotViewError"
      :view-controls-locked="godotViewControlsLocked"
      @patch-view-state="emit('patchGodotViewState', $event)"
    />
  </div>
</template>
