import { useLocalStorageWithDefault } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { AIRI_PLUGIN_NAMESPACE } from '../constants/airi_plugin_meta'
import { supportedControl, useL2dViewControl } from './view-control'

type BroadcastChannelEvents
  = | BroadcastChannelEventShouldUpdateView

interface BroadcastChannelEventShouldUpdateView {
  type: 'live2d-should-update-view'
}

interface Parameter {
  defaultValue: number
  min: number
  max: number
}

export const defaultModelParameters: Record<string, Parameter> = {
  angleX: {
    defaultValue: 0,
    min: -30,
    max: 30,
  },
  angleY: {
    defaultValue: 0,
    min: -30,
    max: 30,
  },
  angleZ: {
    defaultValue: 0,
    min: -30,
    max: 30,
  },
  leftEyeOpen: {
    defaultValue: 1,
    min: 0,
    max: 1,
  },
  rightEyeOpen: {
    defaultValue: 1,
    min: 0,
    max: 1,
  },
  leftEyeSmile: {
    defaultValue: 0,
    min: 0,
    max: 1,
  },
  rightEyeSmile: {
    defaultValue: 0,
    min: 0,
    max: 1,
  },
  leftEyebrowLR: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  rightEyebrowLR: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  leftEyebrowY: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  rightEyebrowY: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  leftEyebrowAngle: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  rightEyebrowAngle: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  leftEyebrowForm: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  rightEyebrowForm: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  mouthOpen: {
    defaultValue: 0,
    min: 0,
    max: 1,
  },
  mouthForm: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  cheek: {
    defaultValue: 0,
    min: 0,
    max: 1,
  },
  bodyAngleX: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  bodyAngleY: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  bodyAngleZ: {
    defaultValue: 0,
    min: -1,
    max: 1,
  },
  breath: {
    defaultValue: 0,
    min: 0,
    max: 1,
  },
}

function stripMinMax(record: Record<string, Parameter>) {
  const stripped: Record<string, number> = {}
  Object.keys(record).forEach((k) => {
    stripped[k] = record[k].defaultValue
  })
  return stripped
}

export const useLive2dParams = defineStore(`${AIRI_PLUGIN_NAMESPACE}.store.modelParam`, () => {
  const { post, data } = useBroadcastChannel<BroadcastChannelEvents, BroadcastChannelEvents>({ name: `${AIRI_PLUGIN_NAMESPACE}.channel.modelParamStore` })
  const shouldUpdateViewHooks = ref(new Set<() => void>())

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView() {
    post({ type: 'live2d-should-update-view' })
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  watch(data, (event) => {
    if (event?.type === 'live2d-should-update-view') {
      shouldUpdateViewHooks.value.forEach(hook => hook())
    }
  })

  const currentMotion = useLocalStorageWithDefault<{ group: string, index?: number }>(`${AIRI_PLUGIN_NAMESPACE}.store.modelParam.currentMotion`, () => ({ group: 'Idle', index: 0 }))
  const availableMotions = useLocalStorageWithDefault<{ motionName: string, motionIndex: number, fileName: string }[]>(`${AIRI_PLUGIN_NAMESPACE}.store.modelParam.availableMotions`, () => [])
  const motionMap = useLocalStorageWithDefault<Record<string, string>>(`${AIRI_PLUGIN_NAMESPACE}.store.modelParam.motionMap`, {})
  const { position, scale, set: setViewControl } = useL2dViewControl()

  // Live2D model parameters
  const modelParameters = useLocalStorageWithDefault<Record<string, number>>(`${AIRI_PLUGIN_NAMESPACE}.store.modelParam.parameters`, stripMinMax(defaultModelParameters))

  function resetState() {
    supportedControl.forEach(c => setViewControl(c))
    currentMotion.reset()
    availableMotions.reset()
    motionMap.reset()
    modelParameters.value = stripMinMax(defaultModelParameters)
    shouldUpdateView()
  }

  return {
    position,
    currentMotion,
    availableMotions,
    motionMap,
    scale,
    modelParameters,

    onShouldUpdateView,
    shouldUpdateView,
    resetState,
    resetModelParameters: () => modelParameters.value = stripMinMax(defaultModelParameters),
  }
})
export { useL2dViewControl }
