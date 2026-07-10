import type { AnalyserWorkletParameters, BeatSyncSpectrumScale } from '@proj-airi/stage-shared/beat-sync'

import { DEFAULT_BEAT_SYNC_PARAMETERS } from '@proj-airi/stage-shared/beat-sync'
import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsBeatSync = defineStore('settings-beat-sync', () => {
  const parameters = useLocalStorageWithDefault<AnalyserWorkletParameters>(
    'settings/beat-sync/parameters',
    { ...DEFAULT_BEAT_SYNC_PARAMETERS },
  )
  const spectrumScale = useLocalStorageWithDefault<BeatSyncSpectrumScale>(
    'settings/beat-sync/spectrum-scale',
    'logarithm',
  )

  function resetState() {
    parameters.value = { ...DEFAULT_BEAT_SYNC_PARAMETERS }
    spectrumScale.value = 'logarithm'
  }

  return {
    parameters,
    spectrumScale,
    resetState,
  }
})
