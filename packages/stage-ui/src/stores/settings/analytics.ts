import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsAnalytics = defineStore('settings-analytics', () => {
  const analyticsEnabled = useLocalStorageWithDefault<boolean>('settings/analytics/enabled', true)

  function resetState() {
    analyticsEnabled.reset()
  }

  return {
    analyticsEnabled,
    resetState,
  }
})
