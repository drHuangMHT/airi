<script setup lang="ts">
import type { animate } from 'animejs'
import type { Application, Container } from 'pixi.js'
import type { CubismModel, InternalModel } from 'untitled-pixi-live2d-engine'

import { until } from '@vueuse/core'
import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { Matrix } from 'pixi.js'
import { CubismFramework, Live2DFactory, Live2DModel, MotionPriority } from 'untitled-pixi-live2d-engine'
import { computed, onUnmounted, ref, shallowRef, toRef, watch } from 'vue'

import {
  useExpressionController,

  useLive2DMotionManagerUpdate,
  useMotionUpdatePluginAutoEyeBlink,
  useMotionUpdatePluginExpression,
  useMotionUpdatePluginIdleDisable,
  useMotionUpdatePluginIdleFocus,
  useMotionUpdatePluginLipSync,
} from '../../../composables/live2d'
import { useFitModel } from '../../../composables/live2d/fit-model'
import { useModelsStore } from '../../../composables/model'
import { useParameterWatchers } from '../../../composables/useLive2dParameterWatchers'
import { Emotion, EmotionNeutralMotionName } from '../../../constants/emotions'
import { useL2dViewControl, useLive2dParams } from '../../../stores'

const props = withDefaults(defineProps<{
  modelId?: string

  app?: Application
  mouthOpenSize?: number
  nowSpeaking?: boolean
  width: number
  height: number
  paused?: boolean
  focusAt?: { x: number, y: number }
  eyeTracking?: boolean
  themeColorsHue?: number
  themeColorsHueDynamic?: boolean
  live2dIdleAnimationEnabled?: boolean
  live2dForceIdleEyeAnimation?: boolean
  live2dAutoBlinkEnabled?: boolean
  live2dForceAutoBlinkEnabled?: boolean
  live2dExpressionEnabled?: boolean
  live2dShadowEnabled?: boolean
}>(), {
  mouthOpenSize: 0,
  nowSpeaking: false,
  paused: false,
  focusAt: () => ({ x: 0, y: 0 }),
  eyeTracking: false,
  disableFocusAt: false,
  scale: 1,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
  live2dIdleAnimationEnabled: true,
  live2dForceIdleEyeAnimation: true,
  live2dAutoBlinkEnabled: true,
  live2dForceAutoBlinkEnabled: false,
  live2dExpressionEnabled: true,
  live2dShadowEnabled: true,
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'error', error: Error): void
}>()

const modelsStore = useModelsStore()
const { selectedModelData } = storeToRefs(modelsStore)

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const { position, scale } = useL2dViewControl()

const modelLoading = ref(false)
// NOTICE: boolean is sufficient; this flag is only used inside loadModel to bail out if the component unmounts mid-load.
let isUnmounted = false

const modelLoadMutex = new Mutex()

const pixiApp = toRef(() => props.app)
const paused = toRef(() => props.paused)
const focusAt = toRef(() => props.focusAt)
let model: Live2DModel<InternalModel> | null = null
const initialModelWidth = ref<number>(0)
const initialModelHeight = ref<number>(0)
const modelContainer = ref<Container | null>(null)
const mouthOpenSize = computed(() => Math.max(0, Math.min(100, props.mouthOpenSize)))
const nowSpeaking = toRef(() => props.nowSpeaking)
const lastUpdateTime = ref(0)

const modelUrls = ref<{ model: string, preview: string } | null>(null)

let resizeAnimation: ReturnType<typeof animate> | undefined

const modelNormalizeParams = useFitModel(
  () => ({ width: props.width, height: props.height }),
  () => ({ width: initialModelWidth.value, height: initialModelHeight.value }),
)

function setScaleAndPosition() {
  if (!model)
    return
  const normalizedScale = modelNormalizeParams.value.scale * scale.value
  const canvasRect = pixiApp.value!.canvas.getBoundingClientRect()
  const toCenterOffsetX = ((canvasRect.width / 2) - (initialModelWidth.value * normalizedScale / 2))
  const toCenterOffsetY = -(canvasRect.height - (initialModelHeight.value / 2) * normalizedScale)
  // const toCenterOffsetX = 0
  // const toCenterOffsetY = 0
  const canvasCenterOffsetX = (position.value.x / 100) * canvasRect.width
  const canvasCenterOffsetY = -(position.value.y / 100) * canvasRect.height
  model.groupTransform.copyFrom(
    new Matrix()
      .scale(normalizedScale, normalizedScale)
      .translate(toCenterOffsetX + canvasCenterOffsetX, toCenterOffsetY + canvasCenterOffsetY),

  )
}

watch([position, scale, modelNormalizeParams], () => {
  setScaleAndPosition()
})

const live2dStore = useLive2dParams()
const {
  currentMotion,
  availableMotions,
  motionMap,
  modelParameters,
} = storeToRefs(live2dStore)

const eyeTrackingEnabled = toRef(() => props.eyeTracking)
const live2dIdleAnimationEnabled = toRef(() => props.live2dIdleAnimationEnabled)
const live2dForceIdleEyeAnimation = toRef(() => props.live2dForceIdleEyeAnimation)
const live2dAutoBlinkEnabled = toRef(() => props.live2dAutoBlinkEnabled)
const live2dForceAutoBlinkEnabled = toRef(() => props.live2dForceAutoBlinkEnabled)
const live2dExpressionEnabled = toRef(() => props.live2dExpressionEnabled)

// --- Expression controller
const internalModelRef = ref<CubismModel>()
const expressionController = useExpressionController({
  internalModel: internalModelRef as any,
  modelId: props.modelId,
})
// Saved SDK manager references for runtime expression toggle (restore on disable)
const savedEyeBlink = shallowRef<any>(null)
const savedExpressionManager = shallowRef<any>(null)

const localCurrentMotion = ref<{ group: string, index: number }>({ group: 'Idle', index: 0 })

// Listen for model reload requests (e.g., when runtime motion is uploaded)
const disposeShouldUpdateView = live2dStore.onShouldUpdateView(() => {
  if (!modelUrls.value || !selectedModelData.value)
    return
  loadModel(modelUrls.value?.model, selectedModelData.value.metadata.identifier)
})

async function loadModel(modelUrl: string, modelId: string) {
  await until(modelLoading).not.toBeTruthy()

  await modelLoadMutex.acquire()

  modelLoading.value = true
  componentState.value = 'loading'

  if (!pixiApp.value || !pixiApp.value.stage) {
    try {
      // NOTICE: shouldUpdateView can fire while the canvas (pixiApp) is being torn down/recreated.
      // Wait briefly for the new stage instead of bailing out, otherwise we keep a blank screen.
      await until(() => !!pixiApp.value && !!pixiApp.value.stage).toBeTruthy({ timeout: 1500 })
    }
    catch {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }
  }

  // REVIEW: here as await until(...) guarded the pixiApp and stage to be valid.
  if (model && pixiApp.value?.stage) {
    // Dispose expression controller before destroying the old model
    expressionController.dispose()
    internalModelRef.value = undefined

    try {
      pixiApp.value.stage.removeChild(model)
      model.destroy()
    }
    catch (error) {
      console.warn('Error removing old model:', error)
    }
    model = null
  }
  if (!selectedModelData) {
    console.warn('No Live2D model source provided.')
    modelLoading.value = false
    componentState.value = 'mounted'
    return
  }

  try {
    if (isUnmounted) {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    const live2DModel = new Live2DModel()
    await Live2DFactory.setupLive2DModel(live2DModel, { url: modelUrl, id: modelId }, { autoInteract: false })
    availableMotions.value.forEach((motion) => {
      if (motion.motionName in Emotion) {
        motionMap.value[motion.fileName] = motion.motionName
      }
      else {
        motionMap.value[motion.fileName] = EmotionNeutralMotionName
      }
    })

    // --- Scene

    model = live2DModel

    model.automator.autoFocus = false
    // REVIEW: pixiApp and stage are guaranteed to be valid here due to the until(...) above.
    initialModelWidth.value = model.width
    initialModelHeight.value = model.height
    pixiApp.value!.stage.addChild(model)
    setScaleAndPosition()

    // --- Interaction

    model.on('hit', (hitAreas) => {
      if (model && hitAreas.includes('body'))
        model.motion('tap_body')
    })

    // --- Motion

    const internalModel = model.internalModel
    const coreModel = internalModel.coreModel as CubismModel
    const motionManager = internalModel.motionManager

    coreModel.setParameterValueById(CubismFramework.getIdManager().getId('ParamMouthOpenY'), mouthOpenSize.value)

    availableMotions.value = Object
      .entries(motionManager.definitions)
      .flatMap(([motionName, definition]) => (definition?.map((motion: any, index: number) => ({
        motionName,
        motionIndex: index,
        fileName: motion.File,
      })) || []))
      .filter(Boolean)

    // Check if user has selected a runtime motion to play as idle
    const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
    const selectedMotionIndex = localStorage.getItem('selected-runtime-motion-index')

    // Configure the selected motion to loop
    if (selectedMotionGroup !== null && selectedMotionIndex) {
      const groupIndex = (motionManager.groups as Record<string, any>)[selectedMotionGroup]
      if (groupIndex !== undefined && motionManager.motionGroups[groupIndex]) {
        const motionIndex = Number.parseInt(selectedMotionIndex)
        const motion = motionManager.motionGroups[groupIndex][motionIndex] as any
        if (motion && motion._looper) {
          // Force the motion to loop
          motion._looper.loopDuration = 0 // 0 means infinite loop
          console.info('Configured motion to loop infinitely:', selectedMotionGroup, motionIndex)
        }
      }
    }

    if (selectedMotionGroup !== null && selectedMotionIndex && live2dIdleAnimationEnabled.value) {
      setTimeout(() => {
        console.info('Playing selected runtime motion:', selectedMotionGroup, selectedMotionIndex)
        currentMotion.value = {
          group: selectedMotionGroup,
          index: Number.parseInt(selectedMotionIndex),
        }
      }, 300)
    }

    // // Remove eye ball movements from idle motion group to prevent conflicts
    // // This is too hacky
    // // FIXME: it cannot blink if loading a model only have idle motion
    // if (motionManager.groups.idle) {
    //   motionManager.motionGroups[motionManager.groups.idle]?.forEach((motion: any) => {
    //     motion._motionData.curves.forEach((curve: any) => {
    //       // TODO: After emotion mapper, stage editor, eye related parameters should be take cared to be dynamical instead of hardcoding
    //       if (curve.id === 'ParamEyeBallX' || curve.id === 'ParamEyeBallY') {
    //         curve.id = `_${curve.id}`
    //       }
    //     })
    //   })
    // }

    // This is hacky too
    const motionManagerUpdate = useLive2DMotionManagerUpdate({
      internalModel,
      motionManager,
      modelParameters,
      live2dEyeTrackingEnabled: eyeTrackingEnabled,
      live2dIdleAnimationEnabled,
      live2dForceIdleEyeAnimation,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      lastUpdateTime,
    })

    motionManagerUpdate.register(useMotionUpdatePluginIdleDisable(), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleFocus(), 'post')
    // Both run in 'final' stage (ignores handled state).
    // Expression first: sets desired parameter values (e.g. closed eyes = 0).
    // Blink second: reads post-expression eye values, Multiply-modulates on top.
    // This ensures blink respects expression state (0 × blinkFactor = 0).
    motionManagerUpdate.register(useMotionUpdatePluginExpression(expressionController), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginAutoEyeBlink(live2dExpressionEnabled), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginLipSync(mouthOpenSize, nowSpeaking), 'final')

    const hookedUpdate = motionManager.update as (model: InternalModel['coreModel'], now: number) => boolean
    motionManager.update = function (model: InternalModel['coreModel'], now: number) {
      return motionManagerUpdate.hookUpdate(model as CubismModel, now, hookedUpdate)
    }

    motionManager.on('motionStart', (group, index) => {
      localCurrentMotion.value = { group, index }
    })

    // Listen for motion finish to restart runtime motion for looping
    motionManager.on('motionFinish', () => {
      const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
      const selectedMotionIndex = localStorage.getItem('selected-runtime-motion-index')

      if (selectedMotionGroup !== null && selectedMotionIndex && live2dIdleAnimationEnabled.value) {
        // Restart the selected runtime motion immediately for seamless looping
        console.info('Motion finished, restarting runtime motion:', selectedMotionGroup, selectedMotionIndex)
        // Use requestAnimationFrame to restart on the next frame for smooth transition
        requestAnimationFrame(() => {
          currentMotion.value = {
            group: selectedMotionGroup,
            index: Number.parseInt(selectedMotionIndex),
          }
        })
      }
    })

    // Save SDK manager references so they can be restored if expression is
    // toggled off at runtime.
    savedEyeBlink.value = internalModel.eyeBlink
    savedExpressionManager.value = motionManager.expressionManager

    // --- Expression controller initialisation (conditional)
    if (live2dExpressionEnabled.value) {
      // Disable built-in Cubism expression manager — our expression-controller
      // replaces it. The SDK's manager runs after motionManager.update() and
      // would overwrite our final-plugin values every frame.
      if (motionManager.expressionManager) {
        ; (motionManager as any).expressionManager = null
      }
      // Disable SDK eyeBlink — it runs on frames where motionUpdated=false and
      // would conflict with expression eye parameter overrides. Our auto-blink
      // plugin (Force Auto Blink setting) provides the replacement for models
      // without idle-motion blink curves.
      if (internalModel.eyeBlink) {
        ; (internalModel as any).eyeBlink = null
      }

      internalModelRef.value = internalModel
    }

    emits('modelLoaded')
  }
  catch (error) {
    console.error('[Live2D] Failed to load model:', error)
    emits('error', error instanceof Error ? error : new Error(String(error)))
  }
  finally {
    modelLoading.value = false
    componentState.value = 'mounted'
    await initExpressionController(internalModelRef.value).catch((err) => {
      console.warn('[Model.vue] Expression controller initialization failed:', err)
    })
    modelLoadMutex.release()
  }
}

/**
 * Initialize the expression controller by reading expression definitions from
 * the model settings (model3.json) and parsing each referenced exp3.json file.
 *
 * This is intentionally fire-and-forget from loadModel so that a failure in
 * expression loading does not prevent the model itself from rendering.
 */
async function initExpressionController(internalModel?: InternalModel) {
  // Dispose any previous state (handles model reloads)
  expressionController.dispose()

  const settings = internalModel?.settings as any
  if (!settings)
    return

  // model3.json stores expressions as { Name, File }[] under settings.expressions
  const expressionRefs: { Name: string, File: string }[] = settings.expressions ?? []
  if (expressionRefs.length === 0)
    return

  // Build a function that can read exp3 files relative to the model root.
  // For URL-loaded models, resolveURL gives us the full URL. For ZIP-loaded
  // models the resolved URL points to an in-memory blob/object URL.
  const readExpFile = async (filePath: string): Promise<string> => {
    const resolvedUrl: string = settings.resolveURL?.(filePath) ?? filePath
    const response = await fetch(resolvedUrl)
    if (!response.ok)
      throw new Error(`Failed to fetch exp3 file: ${filePath} (${response.status})`)
    return response.text()
  }

  await expressionController.initialise(expressionRefs, readExpFile)
}

async function setMotion(motionName: string, index?: number) {
  // TODO: motion? Not every Live2D model has motion, we do need to help users to set motion
  if (!model) {
    console.warn('Cannot set motion: model not loaded')
    return
  }

  console.info('Setting motion:', motionName, 'index:', index)
  try {
    await model.motion(motionName, index, MotionPriority.FORCE)
    console.info('Motion started successfully:', motionName)
  }
  catch (error) {
    console.error('Failed to start motion:', motionName, error)
  }
}

watch(() => selectedModelData.value?.metadata.identifier, async () => {
  console.info(`loading model on stage ${selectedModelData}`)
  if (!selectedModelData.value)
    return
  if (modelUrls.value) {
    Object.values(modelUrls.value).forEach(u => URL.revokeObjectURL(u.toString()))
  }
  modelUrls.value = {
    model: URL.createObjectURL(selectedModelData.value.file),
    preview: URL.createObjectURL(selectedModelData.value.preview),
  }
  await loadModel(modelUrls.value.model, selectedModelData.value.metadata.identifier)
}, { immediate: true })

watch(currentMotion, value => setMotion(value.group, value.index))
watch(paused, (value) => {
  console.info(`stage pause state changed, paused? ${value}`)
  value ? pixiApp.value?.stop() : pixiApp.value?.start()
})

// Watch for idle animation setting changes and stop motions if disabled
watch(live2dIdleAnimationEnabled, (enabled) => {
  if (!enabled && model) {
    const internalModel = model.internalModel
    if (internalModel?.motionManager) {
      internalModel.motionManager.stopAllMotions()
    }
  }
})

// Watch for expression system toggle — nullify/restore SDK managers at runtime
watch(live2dExpressionEnabled, (enabled) => {
  if (!model)
    return
  const im = model.internalModel
  const mm = im.motionManager
  if (enabled) {
    if (mm.expressionManager) {
      (mm as any).expressionManager = null
    }
    if (im.eyeBlink) {
      (im as any).eyeBlink = null
    }

    internalModelRef.value = im
    initExpressionController(im).catch((err) => {
      console.warn('[Model.vue] Expression controller initialisation failed:', err)
    })
  }
  else {
    mm.expressionManager = savedExpressionManager.value
    im.eyeBlink = savedEyeBlink.value
    expressionController.dispose()
    internalModelRef.value = undefined
  }
})

watch(focusAt, (value) => {
  if (!model)
    return
  if (!props.eyeTracking)
    return
  model.focus(value.x, value.y)
})

onUnmounted(() => {
  isUnmounted = true
  resizeAnimation?.pause()
  disposeShouldUpdateView?.()
  expressionController.dispose()
})

function listMotionGroups() {
  return availableMotions.value
}

defineExpose({
  setMotion,
  listMotionGroups,
  modelNormalizeParams,
  initialModelHeight,
  initialModelWidth,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})

useParameterWatchers({
  ParamAngleX: { getter: () => modelParameters.value.angleX },
  ParamAngleY: { getter: () => modelParameters.value.angleY },
  ParamAngleZ: { getter: () => modelParameters.value.angleZ },
  ParamEyeLOpen: { getter: () => modelParameters.value.leftEyeOpen },
  ParamEyeROpen: { getter: () => modelParameters.value.rightEyeOpen },
  ParamMouthOpenY: { getter: () => modelParameters.value.mouthOpen },
  ParamMouthForm: { getter: () => modelParameters.value.mouthForm },
  ParamCheek: { getter: () => modelParameters.value.cheek },
  ParamBodyAngleX: { getter: () => modelParameters.value.bodyAngleX },
  ParamBodyAngleY: { getter: () => modelParameters.value.bodyAngleY },
  ParamBodyAngleZ: { getter: () => modelParameters.value.bodyAngleZ },
  ParamBreath: { getter: () => modelParameters.value.breath },
  ParamBrowLX: { getter: () => modelParameters.value.leftEyebrowLR },
  ParamBrowRX: { getter: () => modelParameters.value.rightEyebrowLR },
  ParamBrowLY: { getter: () => modelParameters.value.leftEyebrowY },
  ParamBrowRY: { getter: () => modelParameters.value.rightEyebrowY },
  ParamBrowLAngle: { getter: () => modelParameters.value.leftEyebrowAngle },
  ParamBrowRAngle: { getter: () => modelParameters.value.rightEyebrowAngle },
  ParamBrowLForm: { getter: () => modelParameters.value.leftEyebrowForm },
  ParamBrowRForm: { getter: () => modelParameters.value.rightEyebrowForm },
}, setModelParam)

function setModelParam(v: number, k: string) {
  if (model) {
    const id = CubismFramework.getIdManager().getId(k)
    const coreModel = model.internalModel.coreModel as CubismModel
    coreModel.setParameterValueById(id, v)
    coreModel.update()
  }
}
</script>

<template>
  <slot />
</template>
