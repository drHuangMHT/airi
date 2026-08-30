import localforage from 'localforage'

import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { Mutex } from 'async-mutex'
import { ref, shallowRef, watch } from 'vue'

export interface ModelMetadata {
  name: string
  identifier: string
  importedAt: number
}

export interface ModelData<M extends ModelMetadata> {
  metadata: M
  file: File
  preview: Blob
}

export function setupCustomModelStore<M extends ModelMetadata>(params: {
  storeIdentifier: string
  builtinModels: (M & { modelUrl: string, previewUrl: string })[]
  getModelPreview: (file: File) => Promise<Blob | null>
  storage?: ModelStorage<M>
}) {
  const storage = params.storage ?? new LocalForageStorage<M>(params.storeIdentifier)
  const SELECTED_MODEL_STORAGE_KEY = `${params.storeIdentifier}.selected_model`

  const loadedModelMetadata = shallowRef<M[]>([])
  const selectedModel = useLocalStorageWithDefault(SELECTED_MODEL_STORAGE_KEY, params.builtinModels[0].identifier)
  const selectedModelData = ref<ModelData<M> | null>(null)
  watch([selectedModel], async () => {
    await loadModelMetadata()
  }, { immediate: true })
  watch([loadedModelMetadata], async (_, __, onInvalidate) => {
    let cancelled = false
    onInvalidate(() => {
      cancelled = true
    })
    const maybeMetadata = loadedModelMetadata.value.find(m => m.identifier === selectedModel.value)
    if (!maybeMetadata || cancelled)
      return
    if (maybeMetadata.identifier === selectedModelData.value?.metadata.identifier)
      return

    const modelData = await getModel(maybeMetadata.identifier)
    if (!cancelled && selectedModel.value === maybeMetadata.identifier) {
      selectedModelData.value = modelData
    }
  }, { immediate: true })
  const mutex = new Mutex()

  function withMutex<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args) => mutex.runExclusive(() => fn(...args))
  }

  async function loadModelsFromUrl(list: (M & { modelUrl: string, previewUrl: string })[]) {
    const existingIds = new Set(loadedModelMetadata.value.map(m => m.identifier))
    for (const model of list) {
      if (!existingIds.has(model.identifier)) {
        try {
          const fileBlob = await (await fetch(model.modelUrl)).blob()
          const fileName = model.modelUrl.split('/').pop() || 'model.zip'
          const file = new File([fileBlob], fileName, { type: fileBlob.type })

          const previewBlob = await (await fetch(model.previewUrl)).blob()

          if (await addModel(model, file, previewBlob)) {
            existingIds.add(model.identifier)
          }
        }
        catch (err) {
          console.error(`Failed to initialize builtin model ${model.identifier}:`, err)
        }
      }
    }
  }

  async function initialize(): Promise<void> {
    await loadModelMetadata()
    await loadModelsFromUrl(params.builtinModels)
  }

  async function loadModelMetadata() {
    loadedModelMetadata.value = (await storage.list()).sort((a, b) => b.importedAt - a.importedAt)
  }

  async function getModel(id: string): Promise<ModelData<M> | null> {
    return storage.get(id)
  }

  async function addModel(metadata: M, file: File, preview: Blob | null = null): Promise<string | null> {
    preview = preview ?? await params.getModelPreview(file)
    if (!preview)
      return null
    try {
      await storage.set({ metadata, file, preview })
    }
    catch {
      await storage.remove(metadata.identifier).catch(() => { })
      return null
    }

    loadedModelMetadata.value = [metadata, ...loadedModelMetadata.value]
    return metadata.identifier
  }

  async function removeModel(id: string): Promise<ModelData<M> | null> {
    loadedModelMetadata.value = loadedModelMetadata.value.filter(model => model.identifier !== id)
    const maybeModelData = await storage.get(id)

    await storage.remove(id)
    selectedModel.value = loadedModelMetadata.value[0].identifier
    return maybeModelData
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
    loadModelsFromUrl: withMutex(loadModelsFromUrl),
  }
}

export interface ModelStorage<M extends ModelMetadata> {
  list: () => Promise<M[]>
  get: (id: string) => Promise<ModelData<M> | null>
  set: (data: ModelData<M>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export class LocalForageStorage<M extends ModelMetadata> implements ModelStorage<M> {
  readonly metadataStorageKey
  constructor(readonly storageIdentifier: string) {
    this.metadataStorageKey = `${this.storageIdentifier}.metadata`
  }

  getStorageKey(id: string) {
    return [
      `${this.metadataStorageKey}.${id}`,
      `${this.storageIdentifier}.file.${id}`,
      `${this.storageIdentifier}.preview.${id}`,
    ]
  }

  async list() {
    const metadata: M[] = []
    try {
      await localforage.iterate<M, void>((val, key) => {
        if (key.startsWith(this.metadataStorageKey)) {
          metadata.push(val)
        }
      })
    }
    catch (err) {
      console.error(err)
      return []
    }
    return metadata
  }

  async remove(id: string) {
    const [metadataKey, fileKey, previewKey] = this.getStorageKey(id)
    await Promise.all([
      localforage.removeItem(metadataKey),
      localforage.removeItem(fileKey),
      localforage.removeItem(previewKey),
    ])
  }

  async get(id: string) {
    const [metadataKey, fileKey, previewKey] = this.getStorageKey(id)
    const r = await Promise.all([
      localforage.getItem<M>(metadataKey),
      localforage.getItem<File>(fileKey),
      localforage.getItem<Blob>(previewKey),
    ])
    return r.some(i => i == null) ? null : { metadata: r[0]!, file: r[1]!, preview: r[2]! }
  }

  async set(data: ModelData<M>) {
    const { metadata, file, preview } = data
    const [metadataKey, fileKey, previewKey] = this.getStorageKey(metadata.identifier)
    await Promise.all([
      localforage.setItem<M>(metadataKey, metadata),
      localforage.setItem<File>(fileKey, file),
      localforage.setItem<Blob>(previewKey, preview),
    ])
  }
}
