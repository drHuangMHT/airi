<script setup lang="ts">
import type {
  StageViewErrorPayload,
  StageViewPatch,
  StageViewSnapshotPayload,
} from '@proj-airi/stage-shared/godot-stage'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSettingsStage } from '../../../../stores/settings'
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

const { currentRenderer } = storeToRefs(useSettingsStage())

const { t } = useI18n()
const modelSelectorOpen = ref(false)
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
      <ModelSelectorDialog v-model:show="modelSelectorOpen">
        <Button variant="secondary">
          {{ t('settings.model-select.select-model.button') }}
        </Button>
      </ModelSelectorDialog>
      <slot name="actions" />
    </div>
    <template v-if="currentRenderer">
      <component
        :is="currentRenderer.modelSettings"
        :allow-extract-colors="allowExtractColors"
        :palette="palette"
        :runtime-snapshot="runtimeSnapshot"
        @extract-colors-from-model="emit('extractColorsFromModel')"
      />
    </template>
  </div>
</template>
