import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, defineAsyncComponent } from 'vue'

const SELECTED_RENDERER_STORAGE_KEY = 'settings.stage.selectedRenderer'

const registeredRenderer = [
  {
    identifier: 'plugin.airi_plugin_stage_live2d',
    name: 'Live2D - pixi6',
    stage: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d/src/components/scenes/Live2D.vue')),
    modelSelector: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d/src/components/ModelSelector.vue')),
    modelSettings: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d/src/components/ModelSettings.vue')),
  },
  {
    identifier: 'plugin.airi_plugin_stage_live2d_cubism5',
    name: 'Live2D - cubism5',
    stage: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d-cubism5/src/components/scenes/Live2D.vue')),
    modelSelector: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d-cubism5/src/components/ModelSelector.vue')),
    modelSettings: defineAsyncComponent(() => import('../../../../../plugins/airi-plugin-stage-live2d-cubism5/src/components/ModelSettings.vue')),
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
