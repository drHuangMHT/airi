import { isStageTamagotchi } from '@proj-airi/stage-shared'

export interface PluginHostProviderSummary {
  name: string
}

export function listProvidersForPluginHost(): PluginHostProviderSummary[] {
  return []
}

export function shouldPublishPluginHostCapabilities() {
  return isStageTamagotchi()
}
