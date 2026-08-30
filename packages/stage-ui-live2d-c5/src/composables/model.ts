import type { ModelMetadata } from '@proj-airi/stage-shared/composables'

import { setupCustomModelStore } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { loadLive2DModelPreview } from '../utils'

const builtinModels: (ModelMetadata & { modelUrl: string, previewUrl: string })[] = [
  {
    name: 'Hiyori Free',
    identifier: 'hiyori_free',
    modelUrl: new URL('../../models/hiyori/hiyori_free_zh.zip', import.meta.url).href,
    previewUrl: new URL('../../models/hiyori/preview.png', import.meta.url).href,
    importedAt: Number.MAX_SAFE_INTEGER - 2,
  },
  {
    name: 'Hiyori Pro',
    identifier: 'hiyori_pro',
    modelUrl: new URL('../../models/hiyori/hiyori_pro_zh.zip', import.meta.url).href,
    previewUrl: new URL('../../models/hiyori/preview.png', import.meta.url).href,
    importedAt: Number.MAX_SAFE_INTEGER - 1,
  },
]

export const useModelsStore = defineStore('plugin.airi_plugin_stage_live2d_cubism5.models', () => setupCustomModelStore({
  storeIdentifier: 'plugin.airi_plugin_stage_live2d_cubism5.models.storage',
  builtinModels,
  getModelPreview: loadLive2DModelPreview,
}))
