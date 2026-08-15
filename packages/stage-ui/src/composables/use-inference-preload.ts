/**
 * Inference model preloading composable.
 *
 * Only preloads models whose providers are configured and added by the user.
 *
 * Call `triggerPreload()` once during app initialization (e.g. in App.vue
 * onMounted, after stores are initialized).
 */

import { useProvidersStore } from '../stores/providers-minimized'
import { useModelPreload } from './use-model-preload'

export interface UseInferencePreloadOptions {
  /** Delay in ms before starting preloads (default: 3000) */
  delayMs?: number
}

interface LoadContext {
  dedicatedGpu: boolean
  dedicatedVRamGB: number
  providerStore: ReturnType<typeof useProvidersStore>
}

const preloadRequests: ((ctx: LoadContext) => void)[] = [() => undefined]

export function useInferencePreload(options: UseInferencePreloadOptions = {}) {
  const { delayMs = 3000 } = options

  const preload = useModelPreload({ delayMs })

  /**
   * Check provider configuration and schedule preloads for any
   * configured local inference providers.
   *
   * Should be called once after app stores are initialized.
   */
  async function triggerPreload(): Promise<void> {
    const providerStore = useProvidersStore()

    const ctx: LoadContext = {
      dedicatedGpu: false,
      dedicatedVRamGB: 0,
      providerStore,
    }
    preloadRequests.map(f => f(ctx))
  }

  return {
    ...preload,
    triggerPreload,
  }
}
