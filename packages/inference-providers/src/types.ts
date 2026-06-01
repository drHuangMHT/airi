export enum Task {
  // GEN_*: generate with creativity
  GEN_TEXT,
  GEN_IMAGE,
  GEN_AUDIO,
  // TO_*: conversion with fidelity
  TO_TEXT,
  TO_SPEECH,
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
   * Icons are available for most of the AI provides under @proj-airi/lobe-icons.
   */
  icon?: string
  iconColor?: string
  /** In case of having image instead of icon, specify the image URL here. */
  iconImage?: URL
  defaultOptions?: Record<string, unknown>
  onboardingFields?: ProviderOnboardingField[]

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
