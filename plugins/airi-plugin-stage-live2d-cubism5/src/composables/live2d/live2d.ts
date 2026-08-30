import type { ComputedRef, Ref } from 'vue'

import { useLocalStorageWithDefault, useVersionedLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { AIRI_PLUGIN_NAMESPACE } from '../../constants/airi_plugin_meta'

const live2dEyeTracking = useLocalStorageWithDefault<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.eyeTrackingEnabled`, false)
/**
 * A position to perform eye-tracking on.
 * Should be a position relative to the application window:
 * - for browser targets, it should be the top-left corner of the viewport
 * - for tamagotchi targets, it should be the top-left corner of
 * the application window that renders the model
 */
const live2dEyeTrackingSource: Ref<ComputedRef<{ x: number, y: number }> | null> = ref(null)
/** Offset from model center to the eyes of the model, in percentages of full model width/height */
const live2dModelEyeOffset = useLocalStorageWithDefault(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.eyeOffset`, { x: 0, y: 0 })
const live2dIdleAnimationEnabled = useLocalStorageWithDefault<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.idleAnimationEnabled`, true)
/** Force the avatar to look around. May conflict with eye tracking and idle animation. */
const live2dForceIdleEyeAnimation = useLocalStorageWithDefault<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.idleEyeAnimationEnabled`, false)
const live2dAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.autoBlinkEnabled`, false, {
  defaultVersion: '2.0.0',
  satisfiesVersionBy(beforeVersion, afterVersion) {
    if (beforeVersion === afterVersion) {
      return true
    }

    return false
  },
})
const live2dForceAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.forceAutoBlinkEnabled`, true, {
  defaultVersion: '2.0.0',
  satisfiesVersionBy(beforeVersion, afterVersion) {
    if (beforeVersion === afterVersion) {
      return true
    }

    return false
  },
})
const live2dExpressionEnabled = useLocalStorageWithDefault<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.expressionEnabled`, false)
const live2dShadowEnabled = useLocalStorageWithDefault<boolean>(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings.dropShadowEnabled`, true)
const live2dMaxFps = useLocalStorageWithDefault<number>(`${AIRI_PLUGIN_NAMESPACE}.store.renderer.maxFps`, 0)
const live2dRenderScale = useLocalStorageWithDefault<number>(`${AIRI_PLUGIN_NAMESPACE}.store.renderer.rendererScale`, 2)

function resetState() {
  live2dEyeTracking.reset()
  live2dModelEyeOffset.reset()
  live2dIdleAnimationEnabled.reset()
  live2dForceIdleEyeAnimation.reset()
  live2dAutoBlinkEnabled.reset()
  live2dForceAutoBlinkEnabled.reset()
  live2dExpressionEnabled.reset()
  live2dShadowEnabled.reset()
  live2dMaxFps.reset()
  live2dRenderScale.reset()
}

export const useSettingsLive2d = defineStore(`${AIRI_PLUGIN_NAMESPACE}.store.generalSettings`, () => {
  return {
    live2dEyeTracking,
    live2dEyeTrackingSource,
    live2dModelEyeOffset,
    live2dIdleAnimationEnabled,
    live2dForceIdleEyeAnimation,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    live2dExpressionEnabled,
    live2dShadowEnabled,
    live2dMaxFps,
    live2dRenderScale,
    resetState,
  }
})
