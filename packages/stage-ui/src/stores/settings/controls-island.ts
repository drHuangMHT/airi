import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsControlsIsland = defineStore('settings-controls-island', () => {
  const allowVisibleOnAllWorkspaces = useLocalStorageWithDefault<boolean>('settings/allow-visible-on-all-workspaces', true)
  const alwaysOnTop = useLocalStorageWithDefault<boolean>('settings/always-on-top', true)
  const controlsIslandIconSize = useLocalStorageWithDefault<'auto' | 'large' | 'small'>('settings/controls-island/icon-size', 'auto')

  function resetState() {
    allowVisibleOnAllWorkspaces.reset()
    alwaysOnTop.reset()
    controlsIslandIconSize.reset()
  }

  return {
    allowVisibleOnAllWorkspaces,
    alwaysOnTop,
    controlsIslandIconSize,
    resetState,
  }
})
