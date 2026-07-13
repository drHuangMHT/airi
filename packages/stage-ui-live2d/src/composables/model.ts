import localforage from 'localforage'

import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { Mutex } from 'async-mutex'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { loadLive2DModelPreview } from '../utils'

const METADATA_STORAGE_KEY = 'plugin.airi_plugin_stage_live2d.model.metadata.'
const FILE_STORAGE_KEY = 'plugin.airi_plugin_stage_live2d.model.file.'
const PREVIEW_STORAGE_KEY = 'plugin.airi_plugin_stage_live2d.model.preview.'
const SELECTED_MODEL_STORAGE_KEY = 'plugin.airi_plugin_stage_live2d.model.selected_model.'

export interface ModelMetadata {
  name: string
  identifier: string
  importedAt: number
}

export interface ModelData {
  metadata: ModelMetadata
  file: File
  preview: Blob
}

function getStorageKey(id: string) {
  return [
    `${METADATA_STORAGE_KEY}${id}`,
    `${FILE_STORAGE_KEY}${id}`,
    `${PREVIEW_STORAGE_KEY}${id}`,
  ]
}

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

export const useModelsStore = defineStore('airi_plugin_stage_live2d.models', () => {
  const loadedModelMetadata = ref<ModelMetadata[]>([])
  const selectedModel = useLocalStorageWithDefault(SELECTED_MODEL_STORAGE_KEY, builtinModels[0].identifier)
  const selectedModelData = ref<ModelData | null>(null)
  watch([selectedModel, loadedModelMetadata], async () => {
    const maybeMetadata = loadedModelMetadata.value.find(m => m.identifier === selectedModel.value)
    if (!maybeMetadata)
      return undefined
    selectedModelData.value = await getModel(maybeMetadata.identifier)
  })
  const mutex = new Mutex()

  function withMutex<T extends (...args: any[]) => Promise<any>>(fn: T): T {
    return (async (...args: Parameters<T>) => {
      return mutex.runExclusive(() => fn(...args))
    }) as T
  }

  async function initialize(): Promise<void> {
    await loadModelMetadata()

    const existingIds = new Set(loadedModelMetadata.value.map(m => m.identifier))
    for (const builtin of builtinModels) {
      if (!existingIds.has(builtin.identifier)) {
        try {
          const fileRes = await fetch(builtin.modelUrl)
          const fileBlob = await fileRes.blob()
          const fileName = builtin.modelUrl.split('/').pop() || 'model.zip'
          const file = new File([fileBlob], fileName, { type: fileBlob.type })

          const previewRes = await fetch(builtin.previewUrl)
          const previewBlob = await previewRes.blob()

          await addModel(builtin, file, previewBlob)
          existingIds.add(builtin.identifier)
        }
        catch (err) {
          console.error(`初始化默认模型 ${builtin.identifier} 失败:`, err)
        }
      }
    }
  }

  async function loadModelMetadata() {
    const metadata: ModelMetadata[] = []
    try {
      await localforage.iterate<ModelMetadata, void>((val, key) => {
        if (key.startsWith(METADATA_STORAGE_KEY)) {
          metadata.push(val)
        }
      })
    }
    catch (err) {
      console.error(err)
    }

    loadedModelMetadata.value = metadata.sort((a, b) => b.importedAt - a.importedAt)
  }

  async function getModel(id: string): Promise<ModelData | null> {
    const [metadata, file, preview] = await getModelFromStorage(id)
    if (metadata == null || file == null || preview == null)
      return null
    return { metadata, file, preview }
  }

  async function addModel(metadata: ModelMetadata, file: File, preview: Blob | null = null): Promise<string | null> {
    const [metadataKey, fileKey, previewKey] = getStorageKey(metadata.identifier)
    const maybeMetadata = await localforage.getItem<Blob>(metadataKey)
    if (maybeMetadata)
      return null
    preview = preview ?? await loadLive2DModelPreview(file)
    if (!preview)
      return null
    try {
      await Promise.all([
        localforage.setItem<ModelMetadata>(metadataKey, metadata),
        localforage.setItem<File>(fileKey, file),
        localforage.setItem<Blob>(previewKey, preview),
      ])
    }
    catch {
      try {
        await removeModelFromStorage(metadata.identifier)
      }
      catch { }
      return null
    }

    loadedModelMetadata.value.unshift(metadata)
    return metadata.identifier
  }

  async function removeModel(id: string): Promise<{ metadata?: ModelMetadata, file?: File, preview?: Blob } | null> {
    loadedModelMetadata.value = loadedModelMetadata.value.filter(model => model.identifier !== id)
    const [metadata, file, preview] = await getModelFromStorage(id)

    const result: { metadata?: ModelMetadata, file?: File, preview?: Blob } = {}
    if (metadata != null)
      result.metadata = metadata
    if (file != null)
      result.file = file
    if (preview != null)
      result.preview = preview

    await removeModelFromStorage(id)
    return Object.keys(result).length === 0 ? null : result
  }

  return {
    models: loadedModelMetadata,
    selectedModel,
    selectedModelData,
    initialize: withMutex(initialize),
    loadModelMetadata: withMutex(loadModelMetadata),
    addModel: withMutex(addModel),
    removeModel: withMutex(removeModel),
    getModel: withMutex(getModel),
  }
})

async function removeModelFromStorage(id: string) {
  const [metadataKey, fileKey, previewKey] = getStorageKey(id)
  return Promise.all([
    localforage.removeItem(metadataKey),
    localforage.removeItem(fileKey),
    localforage.removeItem(previewKey),
  ])
}
async function getModelFromStorage(id: string) {
  const [metadataKey, fileKey, previewKey] = getStorageKey(id)
  return Promise.all([
    localforage.getItem<ModelMetadata>(metadataKey),
    localforage.getItem<File>(fileKey),
    localforage.getItem<Blob>(previewKey),
  ])
}
