import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsSpine = defineStore('settings-spine', () => {
  const spinePremultipliedAlpha = useLocalStorageWithDefault<boolean>('settings/spine/premultiplied-alpha', true)
  const spineDefaultMixDuration = useLocalStorageWithDefault<number>('settings/spine/default-mix', 0.2)
  const spineIdleAnimationEnabled = useLocalStorageWithDefault<boolean>('settings/spine/idle-enabled', true)
  const spineMaxFps = useLocalStorageWithDefault<number>('settings/spine/max-fps', 0)
  const spineRenderScale = useLocalStorageWithDefault<number>('settings/spine/render-scale', 1)

  function resetState() {
    spinePremultipliedAlpha.reset()
    spineDefaultMixDuration.reset()
    spineIdleAnimationEnabled.reset()
    spineMaxFps.reset()
    spineRenderScale.reset()
  }

  return {
    spinePremultipliedAlpha,
    spineDefaultMixDuration,
    spineIdleAnimationEnabled,
    spineMaxFps,
    spineRenderScale,

    resetState,
  }
})
