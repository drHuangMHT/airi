import type {
  ChatProvider,
  ChatProviderWithExtraOptions,
  EmbedProvider,
  EmbedProviderWithExtraOptions,
  ModelProvider,
  SpeechProvider,
  SpeechProviderWithExtraOptions,
  TranscriptionProvider,
  TranscriptionProviderWithExtraOptions,
} from '@xsai-ext/providers/utils'
import type { ProgressInfo } from '@xsai-transformers/shared/types'

import type { ProviderValidationCheck } from '../libs/providers'

import { isUrl } from '@proj-airi/stage-shared'
import { useLocalStorage } from '@vueuse/core'
import { uniqBy } from 'es-toolkit'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { listProviders as listDefinedProviders } from '../libs/providers'
import { useAuthStore } from './auth'

export enum Task {
  // GEN_*: generate with creativity
  GEN_TEXT,
  GEN_IMAGE,
  GEN_AUDIO,
  // TO_*: conversion with fidelity
  TO_TEXT,
  TO_SPEECH,
}

type Provider = ChatProvider
  | ChatProviderWithExtraOptions
  | EmbedProvider
  | EmbedProviderWithExtraOptions
  | SpeechProvider
  | SpeechProviderWithExtraOptions
  | TranscriptionProvider
  | TranscriptionProviderWithExtraOptions

export interface ProviderFactory {
  create: (
    config: Record<string, unknown>,
  ) =>
  Promise<ModelProvider & Provider>
  capabilities: {
    listModels?: (config: Record<string, unknown>) => Promise<ModelInfo[]>
    listVoices?: (config: Record<string, unknown>, model?: string) => Promise<TtsModelInfo[]>
    loadModel?: (config: Record<string, unknown>, hooks?: { onProgress?: (progress: ProgressInfo) => Promise<void> | void }) => Promise<void>
  }
  startupValidations?: ProviderValidationCheck[]
  validators: {
    availableOnPlatform?: () => Promise<boolean>
    /**
     * Validate a provider's configuration.
     *
     * PITFALL: When `skipChatPingCheck` is not set, the ChatCompletions validator
     * (if present) may send a real `generateText("ping")` request that consumes
     * API tokens. All automatic/background callers may consider pass `skipChatPingCheck: true`.
     */
    validateProviderConfig: (config: Record<string, unknown>, options?: { skipPingCheck?: boolean, onlyPingCheck?: boolean }) => Promise<{
      errors: unknown[]
      reason: string
      valid: boolean
    }> | {
      errors: unknown[]
      reason: string
      valid: boolean
    }
    /**
     * Whether the "skip chat ping check" checkbox should be shown in the UI.
     *
     * Automatically derived: `true` when the provider has a ChatCompletions
     * runtime validator AND `disableChatPingCheckUI` is not set on the definition.
     */
    chatPingCheckAvailable: boolean
  }
}

export interface ProviderMetadata {
  /** Globally unique provider identifier. */
  id: string
  /** Placement in a list, highest first. */
  displayPriority: number
  /** Type of the provider. */
  category: 'chat' | 'embed' | 'speech' | 'transcription'
  /** Capability of the provider */
  tasks: Task[]
  i18nNameKey: string // i18n key for provider name
  i18nDescriptionKey: string
  name: string // Default name (fallback)
  description: string // Default description (fallback)
  configured?: boolean

  /**
   * Iconify JSON icon name for the provider.
   *
   * Icons are available for most of the AI provides under @proj-airi/lobe-icons.
   */
  icon?: string
  iconColor?: string
  /**
   * In case of having image instead of icon, you can specify the image URL here.
   */
  iconImage?: URL
  defaultOptions?: Record<string, unknown>

  /**
   * If true, the provider does not require user-provided credentials (e.g. API keys).
   * Used for official/built-in providers that authenticate via session.
   */
  requiresCredentials?: boolean
  transcriptionFeatures?: {
    supportsGenerate: boolean
    supportsStreamOutput: boolean
    supportsStreamInput: boolean
  }
  pricing?: 'free' | 'paid' | 'internal'
  deployment?: 'local' | 'cloud'
  beginnerRecommended?: boolean
  additionalHeaders?: Record<string, string>
}

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  description?: string
  deprecated: boolean
  contextLength: number
}

export interface LlmModelInfo extends ModelInfo {
  capabilities: string[]

}

export interface TtsModelInfo extends ModelInfo {
  gender?: string
  previewURL?: string
  languages: Record<string, unknown>
}

export interface ProviderState {
  configured: boolean
  validatedCredentialHash?: string
  models: ModelInfo[]
  ready: boolean
  status: string | null
  logEntry: string[]
}

function _baseUrlValidator(baseUrl: unknown) {
  if (!baseUrl)
    return 'Base URL is required.'
  if (typeof baseUrl !== 'string')
    return 'Base URL must be a string.'
  if (!isUrl(baseUrl) || new URL(baseUrl).host.length === 0)
    return 'Base URL is not absolute. Try to include a scheme (http:// or https://).'
  if (!baseUrl.endsWith('/'))
    return 'Base URL must end with a trailing slash (/).'
  return 'OK'
}

export const useProvidersStore = defineStore('providers', () => {
  const providerCredentials = useLocalStorage<Record<string, Record<string, unknown>>>('settings/credentials/providers', {})
  const availableProviders = useLocalStorage<Record<string, ProviderMetadata>>('settings/providers/added', {})
  const providerFactories = ref<Record<string, ProviderFactory>>({})
  const providerInstanceCache = ref<Record<string, unknown>>({})

  // Centralized provider metadata with provider factory functions
  const authState = useAuthStore()

  const definedProviders = listDefinedProviders()

  // const validatedCredentials = ref<Record<string, string>>({})
  const providerState = ref<Record<string, ProviderState>>({})
  const providerValidationInFlight = new Map<string, Promise<boolean>>()

  const configuredProviders = computed(() => {
    const result: string[] = []
    for (const [key, state] of Object.entries(providerState.value)) {
      if (state.configured)
        result.push(key)
    }
    return result
  })

  // Configuration validation functions
  async function validateProvider(providerId: string, options: { force?: boolean } = {}): Promise<boolean> {
    const metadata = availableProviders.value[providerId]
    if (!metadata)
      return false

    // Web Speech API doesn't require credentials - use empty config if not present
    if (providerId === 'browser-web-speech-api') {
      if (!providerCredentials.value[providerId]) {
        providerCredentials.value[providerId] = getDefaultProviderConfig(providerId)
      }
    }

    const config = providerCredentials.value[providerId]
    if (!config && providerId !== 'browser-web-speech-api')
      return false

    const configString = JSON.stringify(config || {})
    const runtimeState = providerState.value[providerId]
    const cacheKey = `${providerId}:${configString}`
    const forceValidation = options.force === true

    if (!forceValidation && runtimeState?.validatedCredentialHash === configString && typeof runtimeState.configured === 'boolean')
      return runtimeState.configured

    if (!forceValidation) {
      const pending = providerValidationInFlight.get(cacheKey)
      if (pending) {
        return pending
      }
    }

    const runValidation = async () => {
      // PITFALL: Please consider skip chat ping check during automatic/background validation,
      // since this can consume API tokens and may only be triggered
      // by user action (e.g. "Ping API" button on settings pages) or other user intentions.
      const validationResult = await providerFactories.value[providerId].validators.validateProviderConfig(config || {}, {
        skipPingCheck: true,
      })

      if (providerState.value[providerId]) {
        providerState.value[providerId].configured = validationResult.valid
        providerState.value[providerId].validatedCredentialHash = configString
        // Auto-mark Web Speech API as added if valid and available
        if (validationResult.valid && ['browser-web-speech-api', 'player2'].includes(providerId)) {
          providerState.value[providerId].configured = true
        }
      }

      return validationResult.valid
    }

    if (forceValidation) {
      return runValidation()
    }

    const task = runValidation()
    providerValidationInFlight.set(cacheKey, task)
    return task.finally(() => {
      providerValidationInFlight.delete(cacheKey)
    })
  }

  // Create computed properties for each provider's configuration status

  function getDefaultProviderConfig(providerId: string) {
    const metadata = availableProviders.value[providerId]
    const defaultOptions = metadata?.defaultOptions ?? {}
    return {
      ...defaultOptions,
      ...(Object.hasOwn(defaultOptions, 'baseUrl') ? {} : { baseUrl: '' }),
    }
  }

  // Initialize provider configurations
  function initializeProvider(providerId: string) {
    if (!providerCredentials.value[providerId]) {
      providerCredentials.value[providerId] = getDefaultProviderConfig(providerId)
    }
    if (!providerState.value[providerId]) {
      providerState.value[providerId] = {
        configured: false,
        models: [],
        ready: false,
        status: null,
        logEntry: [],
      }
    }
  }

  // Initialize all providers
  Object.keys(availableProviders.value).forEach(initializeProvider)

  // Update configuration status for all configured providers
  async function updateConfigurationStatus() {
    await Promise.all(Object.entries(availableProviders.value)
      // TODO: ignore un-configured provider
      // .filter(([_, provider]) => provider.configured)
      .map(async ([providerId]) => {
        try {
          if (providerState.value[providerId]) {
            const isValid = await validateProvider(providerId)
            providerState.value[providerId].configured = isValid
          }
        }
        catch {
          if (providerState.value[providerId]) {
            providerState.value[providerId].configured = false
          }
        }
      }))
  }

  // Call initially and watch for changes
  watch(providerCredentials, updateConfigurationStatus, { deep: true, immediate: true })

  watch(() => authState.isAuthenticated, updateConfigurationStatus)

  // Store available models for each provider
  const availableModels = computed(() => {
    const result: Record<string, ModelInfo[]> = {}
    for (const [key, state] of Object.entries(providerState.value)) {
      result[key] = state.models
    }
    return result
  })

  const isLoadingModels = computed(() => {
    const result: Record<string, boolean> = {}
    for (const [key, state] of Object.entries(providerState.value)) {
      result[key] = state.ready
    }
    return result
  })

  function deleteProvider(providerId: string) {
    delete providerCredentials.value[providerId]
    delete providerState.value[providerId]
    delete availableProviders.value[providerId]
  }

  function forceProviderConfigured(providerId: string) {
    if (providerState.value[providerId]) {
      providerState.value[providerId].configured = true
      // Also cache the current config to prevent re-validation from overwriting
      const config = providerCredentials.value[providerId]
      if (config) {
        providerState.value[providerId].validatedCredentialHash = JSON.stringify(config)
      }
    }
    providerState.value[providerId].configured = true
  }

  function setProviderUnconfigured(providerId: string) {
    if (providerState.value[providerId]) {
      providerState.value[providerId].configured = false
      providerState.value[providerId].validatedCredentialHash = undefined
    }
    providerState.value[providerId].configured = false
  }

  async function resetProviderSettings() {
    providerCredentials.value = {}
    availableProviders.value = {}
    providerState.value = {}

    Object.keys(availableProviders.value).forEach(initializeProvider)
    await updateConfigurationStatus()
  }

  // Function to fetch models for a specific provider
  async function fetchModelsForProvider(providerId: string) {
    const metadata = availableProviders.value[providerId]
    const factory = providerFactories.value[providerId]
    if (!metadata)
      return []

    const config = providerCredentials.value[providerId]
    if (!config && metadata.requiresCredentials !== false)
      return []

    const runtimeState = providerState.value[providerId]
    if (runtimeState) {
      runtimeState.ready = true
    }

    try {
      const models = factory.capabilities.listModels ? await factory.capabilities.listModels(config || {}) : []

      // Transform and store the models
      if (runtimeState) {
        runtimeState.models = uniqBy(models.filter(model => !!model.id), m => m.id)
          .map(model => ({
            id: model.id,
            name: model.name,
            description: model.description,
            contextLength: model.contextLength,
            deprecated: model.deprecated,
            providerId,
          }))
        return runtimeState.models
      }
      return []
    }
    catch (error) {
      console.error(`Error fetching models for ${providerId}:`, error)
      if (runtimeState) {
        runtimeState.logEntry.push(error instanceof Error ? error.message : 'Unknown error')
      }
      return []
    }
    finally {
      if (runtimeState) {
        runtimeState.ready = false
      }
    }
  }

  // Get models for a specific provider
  function getModelsForProvider(providerId: string) {
    return providerState.value[providerId]?.models || []
  }

  // Get all available models across all configured providers
  const allAvailableModels = computed(() => {
    const models: ModelInfo[] = []
    for (const providerId of configuredProviders.value) {
      models.push(...(providerState.value[providerId]?.models || []))
    }
    return models
  })

  // Load models for all configured providers
  async function loadModelsForConfiguredProviders() {
    for (const providerId of configuredProviders.value) {
      if (providerFactories.value[providerId].capabilities.listModels) {
        await fetchModelsForProvider(providerId)
      }
    }
  }
  const previousCredentialHashes = ref<Record<string, string>>({})

  // Watch for credential changes and refetch models accordingly
  watch(providerCredentials, (newCreds) => {
    const changedProviders: string[] = []

    for (const providerId in newCreds) {
      const currentConfig = newCreds[providerId]
      const currentHash = JSON.stringify(currentConfig)
      const previousHash = previousCredentialHashes.value[providerId]

      if (currentHash !== previousHash) {
        changedProviders.push(providerId)
        previousCredentialHashes.value[providerId] = currentHash
      }
    }

    for (const providerId of changedProviders) {
      // Since credentials changed, dispose the cached instance so new creds take effect.
      void disposeProviderInstance(providerId)

      // If the provider is configured and has the capability, refetch its models
      if (providerState.value[providerId]?.configured && providerFactories.value[providerId]?.capabilities.listModels) {
        fetchModelsForProvider(providerId)
      }
    }
  }, { deep: true, immediate: true })

  const allProvidersMetadata = computed(() => {
    const ordered = definedProviders
      .filter(d => availableProviders.value[d.id])

    return [...ordered]
  })

  function getTranscriptionFeatures(providerId: string) {
    const metadata = availableProviders.value[providerId]
    const features = metadata?.transcriptionFeatures

    return {
      supportsGenerate: features?.supportsGenerate ?? true,
      supportsStreamOutput: features?.supportsStreamOutput ?? false,
      supportsStreamInput: features?.supportsStreamInput ?? false,
    }
  }

  // Function to get provider object by provider id
  async function getProviderInstance<R extends
  | ChatProvider
  | ChatProviderWithExtraOptions
  | EmbedProvider
  | EmbedProviderWithExtraOptions
  | SpeechProvider
  | SpeechProviderWithExtraOptions
  | TranscriptionProvider
  | TranscriptionProviderWithExtraOptions,
  >(providerId: string): Promise<R> {
    const cached = providerInstanceCache.value[providerId] as R | undefined
    if (cached)
      return cached

    const metadata = availableProviders.value[providerId]
    const factory = providerFactories.value[providerId]
    if (!metadata)
      throw new Error(`Provider metadata for ${providerId} not found`)

    // Providers that don't require credentials use empty config
    let config = providerCredentials.value[providerId]
    const noCredentials = metadata.requiresCredentials === false || providerId === 'browser-web-speech-api'
    if (!config && noCredentials) {
      config = getDefaultProviderConfig(providerId) || {}
      providerCredentials.value[providerId] = config
    }

    if (!config && !noCredentials)
      throw new Error(`Provider credentials for ${providerId} not found`)

    try {
      const instance = await factory.create(config || {}) as unknown as R
      providerInstanceCache.value[providerId] = instance
      return instance
    }
    catch (error) {
      console.error(`Error creating provider instance for ${providerId}:`, error)
      throw error
    }
  }

  async function disposeProviderInstance(providerId: string) {
    const instance = providerInstanceCache.value[providerId] as { dispose?: () => Promise<void> | void } | undefined
    if (instance?.dispose)
      await instance.dispose()

    delete providerInstanceCache.value[providerId]
  }

  function getProviderConfig(providerId: string) {
    return providerCredentials.value[providerId]
  }

  return {
    providers: providerCredentials,
    providerFactories,
    getProviderConfig,
    addedProviders: availableProviders,
    deleteProvider,
    configuredProviders,
    providerRuntimeState: providerState,
    getTranscriptionFeatures,
    allProvidersMetadata,
    initializeProvider,
    validateProvider,
    availableModels,
    isLoadingModels,
    fetchModelsForProvider,
    getModelsForProvider,
    allAvailableModels,
    loadModelsForConfiguredProviders,
    getProviderInstance,
    disposeProviderInstance,
    resetProviderSettings,
    forceProviderConfigured,
    setProviderUnconfigured,
  }
})
