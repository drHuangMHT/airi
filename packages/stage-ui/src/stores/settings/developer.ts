import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsDeveloper = defineStore('settings-developer', () => {
  const inspectUpdaterDiagnostics = useLocalStorageWithDefault<boolean>('settings/developer/inspect-updater-diagnostics', false)

  function resetState() {
    inspectUpdaterDiagnostics.reset()
  }

  return {
    inspectUpdaterDiagnostics,
    resetState,
  }
})
