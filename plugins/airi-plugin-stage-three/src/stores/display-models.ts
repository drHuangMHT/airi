import type { ModelMetadata } from '@proj-airi/stage-shared/composables'

import { setupCustomModelStore } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { loadVrmModelPreview } from '../utils/vrm-preview'

const builtinModels: (ModelMetadata & { modelUrl: string, previewUrl: string })[] = [
  {
    name: 'AvatarSample_A',
    identifier: 'avatar.airi_plugin_stage_three.avatar_sample_a',
    modelUrl: new URL('../../models/AvatarSample-A/AvatarSample_A.vrm', import.meta.url).href,
    previewUrl: new URL('../../models/AvatarSample-A/preview.png', import.meta.url).href,
    importedAt: 1733113886840,
  },
  {
    name: 'AvatarSample_B',
    identifier: 'avatar.airi_plugin_stage_three.avatar_sample_b',
    modelUrl: new URL('../../models/AvatarSample-B/AvatarSample_B.vrm', import.meta.url).href,
    previewUrl: new URL('../../models/AvatarSample-B/preview.png', import.meta.url).href,
    importedAt: 1733113886840,
  },
]

export interface DisplayModel {
  id: string
  url: string
  name: string
  previewImage?: string
  importedAt: number
}

export const useModelsStore = defineStore('plugin.airi_plugin_stage_vrm.models', () => setupCustomModelStore({
  storeIdentifier: 'airi_plugin_stage_three.models.storage',
  builtinModels,
  getModelPreview: loadVrmModelPreview,
}))
