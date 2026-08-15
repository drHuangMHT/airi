import type { DisplayModel } from '../display-models'

import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { refManualReset, useEventListener } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, defineAsyncComponent, watch } from 'vue'

import { DisplayModelFormat, useModelsStore } from '../display-models'

export type StageModelRenderer = 'live2d' | 'vrm' | 'spine' | 'godot' | 'disabled' | undefined
type BuiltInStageModelRenderer = Exclude<StageModelRenderer, 'godot'>

const SELECTED_RENDERER_STORAGE_KEY = 'settings.stage.selectedRenderer'

const registeredRenderer = [
  {
    identifier: 'plugin.airi_plugin_stage_live2d',
    name: 'Live2D - pixi6',
    stage: defineAsyncComponent(() => import('../../../../stage-ui-live2d/src/components/scenes/Live2D.vue')),
    modelSelector: defineAsyncComponent(() => import('../../../../stage-ui-live2d/src/components/ModelSelector.vue')),
    modelSettings: defineAsyncComponent(() => import('../../../../stage-ui-live2d/src/components/ModelSettings.vue')),
  },
  {
    identifier: 'plugin.airi_plugin_stage_live2d_cubism5',
    name: 'Live2D - cubism5',
    stage: defineAsyncComponent(() => import('../../../../stage-ui-live2d-c5/src/components/scenes/Live2D.vue')),
    modelSelector: defineAsyncComponent(() => import('../../../../stage-ui-live2d-c5/src/components/ModelSelector.vue')),
    modelSettings: defineAsyncComponent(() => import('../../../../stage-ui-live2d-c5/src/components/ModelSettings.vue')),
  },
  {
    identifier: 'plugin.airi_plugin_stage_three',
    name: 'VRM',
    stage: defineAsyncComponent(() => import('../../../../stage-ui-three/src/components/ThreeScene.vue')),
    modelSelector: defineAsyncComponent(() => import('../../../../stage-ui-three/src/components/ModelSelector.vue')),
    modelSettings: defineAsyncComponent(() => import('../../../../stage-ui-three/src/components/ModelSettings.vue')),
  },
]

export const useSettingsStage = defineStore('settings-stage', () => {
  const selectedRenderer = useLocalStorageWithDefault(SELECTED_RENDERER_STORAGE_KEY, 'plugin.airi_plugin_stage_live2d')
  const currentRenderer = computed(() => registeredRenderer.find(s => s.identifier === selectedRenderer.value))

  return {
    selectedRenderer,
    currentRenderer,
    registeredStage: registeredRenderer,
  }
})

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useModelsStore()
  let stageModelUpdateSequence = 0
  const stageModelStorageKey = 'settings/stage/model'

  const stageModelSelectedState = useLocalStorageWithDefault<string>(stageModelStorageKey, 'preset-live2d-1')
  const stageModelSelected = computed<string>({
    get: () => stageModelSelectedState.value,
    set: (value) => {
      stageModelSelectedState.value = value
    },
  })
  const stageModelSelectedDisplayModel = refManualReset<DisplayModel | undefined>(undefined)
  const stageModelSelectedUrl = refManualReset<string | undefined>(undefined)
  const stageModelRenderer = refManualReset<StageModelRenderer>(undefined)
  const stageModelBuiltInRenderer = refManualReset<BuiltInStageModelRenderer>(undefined)

  const stageViewControlsEnabled = refManualReset<boolean>(false)

  function revokeStageModelUrl(url?: string) {
    if (url?.startsWith('blob:'))
      URL.revokeObjectURL(url)
  }

  function replaceStageModelUrl(nextUrl?: string) {
    if (stageModelSelectedUrl.value === nextUrl)
      return

    revokeStageModelUrl(stageModelSelectedUrl.value)
    stageModelSelectedUrl.value = nextUrl
  }

  function resolveBuiltInStageModelRenderer(model?: DisplayModel): BuiltInStageModelRenderer {
    if (!model) {
      return 'disabled'
    }

    switch (model.format) {
      case DisplayModelFormat.Live2dZip:
        return 'live2d'
      case DisplayModelFormat.VRM:
        return 'vrm'
      case DisplayModelFormat.SpineZip:
        return 'spine'
      default:
        return 'disabled'
    }
  }

  async function updateStageModel() {
    const requestId = ++stageModelUpdateSequence
    const selectedModelId = stageModelSelectedState.value

    if (!selectedModelId) {
      replaceStageModelUrl(undefined)
      stageModelSelectedDisplayModel.value = undefined
      stageModelBuiltInRenderer.value = 'disabled'
      if (stageModelRenderer.value !== 'godot')
        stageModelRenderer.value = 'disabled'
      return
    }

    const model = await displayModelsStore.getDisplayModel(selectedModelId)
    if (requestId !== stageModelUpdateSequence)
      return

    if (!model) {
      replaceStageModelUrl(undefined)
      stageModelSelectedDisplayModel.value = undefined
      stageModelBuiltInRenderer.value = 'disabled'
      if (stageModelRenderer.value !== 'godot')
        stageModelRenderer.value = 'disabled'
      return
    }

    const builtInRenderer = resolveBuiltInStageModelRenderer(model)
    stageModelBuiltInRenderer.value = builtInRenderer
    if (stageModelRenderer.value !== 'godot')
      stageModelRenderer.value = builtInRenderer

    if (model.type === 'file') {
      const nextUrl = URL.createObjectURL(model.file)
      if (requestId !== stageModelUpdateSequence) {
        URL.revokeObjectURL(nextUrl)
        return
      }

      replaceStageModelUrl(nextUrl)
    }
    else {
      replaceStageModelUrl(model.url)
    }

    stageModelSelectedDisplayModel.value = model
  }

  function setStageModelRenderer(renderer: StageModelRenderer) {
    stageModelRenderer.value = renderer
  }

  function restoreBuiltInStageModelRenderer() {
    stageModelRenderer.value = stageModelBuiltInRenderer.value ?? 'disabled'
  }

  async function initializeStageModel() {
    await updateStageModel()
  }

  useEventListener('unload', () => {
    revokeStageModelUrl(stageModelSelectedUrl.value)
  })

  watch(stageModelSelectedState, (_newValue, _oldValue) => {
    void updateStageModel()
  })

  async function resetState() {
    revokeStageModelUrl(stageModelSelectedUrl.value)

    stageModelSelectedState.reset()
    stageModelSelectedDisplayModel.reset()
    stageModelSelectedUrl.reset()
    stageModelRenderer.reset()
    stageModelBuiltInRenderer.reset()
    stageViewControlsEnabled.reset()

    await updateStageModel()
  }

  return {
    stageModelRenderer,
    stageModelSelected,
    stageModelSelectedUrl,
    stageModelSelectedDisplayModel,
    stageViewControlsEnabled,

    initializeStageModel,
    restoreBuiltInStageModelRenderer,
    setStageModelRenderer,
    updateStageModel,
    resetState,
  }
})
