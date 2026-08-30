import localforage from 'localforage'

import { until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export enum DisplayModelFormat {
  Live2dZip = 'live2d-zip',
  Live2dDirectory = 'live2d-directory',
  VRM = 'vrm',
  SpineZip = 'spine-zip',
  PMXZip = 'pmx-zip',
  PMXDirectory = 'pmx-directory',
  PMD = 'pmd',
}

export type DisplayModel
  = | DisplayModelFile
    | DisplayModelURL

interface ModelMetadata {
  name: string
  identifier: string
  modelUrl: string
  previewUrl: string
}

const builtinModels: Record<string, ModelMetadata[]> = {
  'airi-plugin-stage-three': [
    {
      name: 'AvatarSample_A',
      identifier: 'avatar.airi_plugin_stage_three.avatar_sample_a',
      modelUrl: new URL('../assets/vrm/models/AvatarSample-A/AvatarSample_A.vrm', import.meta.url).href,
      previewUrl: new URL('../assets/vrm/models/AvatarSample-A/preview.png', import.meta.url).href,
    },
    {
      name: 'AvatarSample_B',
      identifier: 'avatar.airi_plugin_stage_three.avatar_sample_b',
      modelUrl: new URL('../assets/vrm/models/AvatarSample-B/AvatarSample_B.vrm', import.meta.url).href,
      previewUrl: new URL('../assets/vrm/models/AvatarSample-B/preview.png', import.meta.url).href,
    },
  ],
}

export interface DisplayModelFile {
  id: string
  format: DisplayModelFormat
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
}

export interface DisplayModelURL {
  id: string
  format: DisplayModelFormat
  type: 'url'
  url: string
  name: string
  previewImage?: string
  importedAt: number
}

const modelsPresets: DisplayModel[] = [
  {
    id: 'preset-vrm-1',
    format: DisplayModelFormat.VRM,
    type: 'url',
    url: builtinModels['airi-plugin-stage-three'][0].modelUrl,
    name: 'AvatarSample_A',
    previewImage: builtinModels['airi-plugin-stage-three'][0].previewUrl,
    importedAt: 1733113886840,
  },
  {
    id: 'preset-vrm-2',
    format: DisplayModelFormat.VRM,
    type: 'url',
    url: builtinModels['airi-plugin-stage-three'][1].modelUrl,
    name: 'AvatarSample_B',
    previewImage: builtinModels['airi-plugin-stage-three'][1].previewUrl,
    importedAt: 1733113886840,
  },
]

export const useModelsStore = defineStore('display-models', () => {
  const models = ref<DisplayModel[]>([])

  let generateVrmPreview: (file: File) => Promise<string | undefined>
  let generateSpinePreview: (file: File) => Promise<string | undefined>

  const modelsFromIndexedDBLoading = ref(false)

  async function loadModelsFromIndexedDB() {
    await until(modelsFromIndexedDBLoading).toBe(false)

    modelsFromIndexedDBLoading.value = true
    const loadedModels = [...modelsPresets]

    try {
      await localforage.iterate<{ format: DisplayModelFormat, file: File, importedAt: number, previewImage?: string }, void>((val, key) => {
        if (key.startsWith('display-model-')) {
          loadedModels.push({ id: key, format: val.format, type: 'file', file: val.file, name: val.file.name, importedAt: val.importedAt, previewImage: val.previewImage })
        }
      })
    }
    catch (err) {
      console.error(err)
    }

    models.value = loadedModels.sort((a, b) => b.importedAt - a.importedAt)
    modelsFromIndexedDBLoading.value = false
  }

  async function getDisplayModel(id: string) {
    await until(modelsFromIndexedDBLoading).toBe(false)
    // NOTICE:
    // Newly imported file models are inserted into displayModels before callers pick them.
    // Reading memory first keeps updateStageModel from racing an IndexedDB write and treating
    // a just-imported display-model id as missing, which used to fall back to the default model.
    // Source/context: model-selector confirmImport/handleAddVRMModel -> model-settings handleModelPick.
    // Removal condition: custom model imports and selection are handled by a single transactional API.
    const modelFromMemory = models.value.find(model => model.id === id)
    if (modelFromMemory)
      return modelFromMemory

    const modelFromFile = await localforage.getItem<DisplayModelFile>(id)
    if (modelFromFile) {
      return modelFromFile
    }

    // Fallback to in-memory presets if not found in localforage
    return modelsPresets.find(model => model.id === id)
  }

  const loadVrmModelPreview = (file: File) => generateVrmPreview(file)
  const loadSpineModelPreview = (file: File) => generateSpinePreview(file)

  async function addModel(format: DisplayModelFormat, file: File) {
    await until(modelsFromIndexedDBLoading).toBe(false)
    const newDisplayModel: DisplayModelFile = { id: `display-model-${nanoid()}`, format, type: 'file', file, name: file.name, importedAt: Date.now() }

    if (format === DisplayModelFormat.VRM) {
      const previewImage = await loadVrmModelPreview(file)
      newDisplayModel.previewImage = previewImage
    }
    else if (format === DisplayModelFormat.SpineZip) {
      const previewImage = await loadSpineModelPreview(file)
      newDisplayModel.previewImage = previewImage
    }

    models.value.unshift(newDisplayModel)

    // NOTICE:
    // Keep this awaited. The settings model pick flow can call getDisplayModel immediately
    // after import; fire-and-forget persistence creates a race where the selected custom model
    // exists in the UI but is not yet readable from IndexedDB in a later route/render pass.
    // Source/context: model-selector import flow -> settings-stage-model.updateStageModel().
    // Removal condition: imported display models are persisted through a transactional queue
    // that blocks pick/navigation until the write is durably complete.
    await localforage.setItem<DisplayModelFile>(newDisplayModel.id, newDisplayModel)
      .catch(err => console.error(err))

    return newDisplayModel
  }

  async function renameModel(id: string, name: string) {
    await until(modelsFromIndexedDBLoading).toBe(false)
    const displayModel = id.startsWith('display-model-')
      ? await localforage.getItem<DisplayModelFile>(id)
      : models.value.find(m => m.id === id)

    if (!displayModel)
      return

    displayModel.name = name

    // Update reactive state
    const index = models.value.findIndex(m => m.id === id)
    if (index !== -1) {
      models.value[index].name = name
    }

    // Persist if it's a file-based model
    if (id.startsWith('display-model-')) {
      await localforage.setItem(id, displayModel)
    }
  }

  async function removeModel(id: string) {
    await until(modelsFromIndexedDBLoading).toBe(false)
    await localforage.removeItem(id)
    models.value = models.value.filter(model => model.id !== id)
  }

  async function resetModels() {
    await loadModelsFromIndexedDB()
    const userModelIds = models.value.filter(model => model.type === 'file').map(model => model.id)
    for (const id of userModelIds) {
      await removeModel(id)
    }

    models.value = [...modelsPresets].sort((a, b) => b.importedAt - a.importedAt)
  }

  async function initialize() {
    const { loadVrmModelPreview } = await import('@proj-airi/stage-ui-three/utils/vrm-preview')
    const { loadSpineModelPreview } = await import('@proj-airi/stage-ui-spine/utils/spine-preview')

    generateVrmPreview = loadVrmModelPreview
    generateSpinePreview = loadSpineModelPreview
  }

  return {
    displayModels: models,
    displayModelsFromIndexedDBLoading: modelsFromIndexedDBLoading,

    initialize,
    loadDisplayModelsFromIndexedDB: loadModelsFromIndexedDB,
    getDisplayModel,
    addDisplayModel: addModel,
    renameDisplayModel: renameModel,
    removeDisplayModel: removeModel,
    resetDisplayModels: resetModels,
  }
})
