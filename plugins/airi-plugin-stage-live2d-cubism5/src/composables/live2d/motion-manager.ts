import type { CubismInternalModel, InternalModel } from 'untitled-pixi-live2d-engine'
import type { Ref } from 'vue'

import type { useExpressionController } from './expression-controller'

import { CubismFramework } from 'untitled-pixi-live2d-engine'

import { useLive2DIdleEyeFocus } from './animation'

type CubismModel = CubismInternalModel['coreModel']
type CubismEyeBlink = CubismInternalModel['eyeBlink']

export type PixiLive2DInternalModel = InternalModel & {
  eyeBlink?: CubismEyeBlink
  coreModel: CubismModel
}

export interface MotionManagerUpdateContext {
  model: CubismModel
  // in seconds
  now: number
  // in seconds
  timeDelta: number
  hookedUpdate?: (model: CubismModel, now: number) => boolean
}

export type MotionManagerPluginContext = MotionManagerUpdateContext & {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  modelParameters: Ref<any>
  live2dEyeTrackingEnabled: Ref<boolean>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dForceIdleEyeAnimation: Ref<boolean>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  isIdleMotion: boolean
  handled: boolean
  markHandled: () => void
}

export type MotionManagerPlugin = (ctx: MotionManagerPluginContext) => void

export interface UseLive2DMotionManagerUpdateOptions {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  modelParameters: Ref<any>
  live2dEyeTrackingEnabled: Ref<boolean>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dForceIdleEyeAnimation: Ref<boolean>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  lastUpdateTime: Ref<number>
}

export function useLive2DMotionManagerUpdate(options: UseLive2DMotionManagerUpdateOptions) {
  const {
    internalModel,
    motionManager,
    modelParameters,
    live2dEyeTrackingEnabled,
    live2dIdleAnimationEnabled,
    live2dForceIdleEyeAnimation,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    lastUpdateTime,
  } = options

  const prePlugins: MotionManagerPlugin[] = []
  const postPlugins: MotionManagerPlugin[] = []
  const finalPlugins: MotionManagerPlugin[] = []

  function register(plugin: MotionManagerPlugin, stage: 'pre' | 'post' | 'final' = 'pre') {
    if (stage === 'pre')
      prePlugins.push(plugin)
    else if (stage === 'final')
      finalPlugins.push(plugin)
    else
      postPlugins.push(plugin)
  }

  function runPlugins(plugins: MotionManagerPlugin[], ctx: MotionManagerPluginContext) {
    for (const plugin of plugins) {
      if (ctx.handled)
        break
      plugin(ctx)
    }
  }

  function hookUpdate(model: CubismModel, now: number, hookedUpdate?: (model: CubismModel, now: number) => boolean) {
    const timeDelta = lastUpdateTime.value ? now - lastUpdateTime.value : 0
    const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
    const isIdleMotion = !motionManager.state.currentGroup
      || motionManager.state.currentGroup === motionManager.groups.idle
      || (!!selectedMotionGroup && motionManager.state.currentGroup === selectedMotionGroup)

    const ctx: MotionManagerPluginContext = {
      model,
      now,
      timeDelta,
      hookedUpdate,
      internalModel,
      motionManager,
      modelParameters,
      live2dEyeTrackingEnabled,
      live2dIdleAnimationEnabled,
      live2dForceIdleEyeAnimation,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      isIdleMotion,
      handled: false,
      markHandled: () => {
        ctx.handled = true
      },
    }

    runPlugins(prePlugins, ctx)

    if (!ctx.handled && ctx.hookedUpdate) {
      const result = ctx.hookedUpdate.call(motionManager, model, now)
      if (result)
        ctx.handled = true
    }

    runPlugins(postPlugins, ctx)

    // Final plugins always run regardless of handled state (e.g. expression overrides)
    for (const plugin of finalPlugins) {
      plugin(ctx)
    }

    lastUpdateTime.value = now
    return ctx.handled
  }

  return {
    register,
    hookUpdate,
  }
}

// -- Plugins ---------------------------------------------------------------

export function useMotionUpdatePluginIdleDisable(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (ctx.handled)
      return

    // Stop idle motions if they're disabled
    if (!ctx.live2dIdleAnimationEnabled.value && ctx.isIdleMotion) {
      ctx.motionManager.stopAllMotions()

      if (ctx.live2dForceIdleEyeAnimation.value)
        idleEyeFocus.update(ctx.internalModel, ctx.now)
      if (ctx.internalModel.eyeBlink != null) {
        ctx.internalModel.eyeBlink.updateParameters(ctx.model, ctx.timeDelta / 1000)
      }

      // Apply manual eye parameters after auto eye blink
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), ctx.modelParameters.value.leftEyeOpen)
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), ctx.modelParameters.value.rightEyeOpen)

      ctx.markHandled()
    }
  }
}

export function useMotionUpdatePluginIdleFocus(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (!ctx.isIdleMotion || ctx.handled)
      return

    idleEyeFocus.update(ctx.internalModel, ctx.now)
  }
}

export function useMotionUpdatePluginAutoEyeBlink(
  live2dExpressionEnabled?: Ref<boolean>,
): MotionManagerPlugin {
  const blinkState = {
    phase: 'idle' as 'idle' | 'closing' | 'opening',
    progress: 0,
    startLeft: 1,
    startRight: 1,
    delayMs: 0,
    openDurationMs: 300,
  }

  // Eye values captured at blink start.  Used as the base during
  // closing/opening so that models without eye motion curves don't
  // get stuck at 0 (since 0 × factor = 0 forever).
  let preBlinkLeft = 1.0
  let preBlinkRight = 1.0
  const blinkCloseDuration = 75 // ms
  const minBlinkOpenDuration = 150 // ms
  const maxBlinkOpenDuration = 300 // ms
  const minDelay = 3000
  const maxDelay = 8000

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
  const randomBlinkOpenDuration = () => minBlinkOpenDuration + Math.random() * (maxBlinkOpenDuration - minBlinkOpenDuration)

  function resetBlinkState() {
    blinkState.phase = 'idle'
    blinkState.progress = 0
    blinkState.delayMs = minDelay + Math.random() * (maxDelay - minDelay)
  }
  resetBlinkState()

  function easeOutQuad(t: number) {
    return 1 - (1 - t) * (1 - t)
  }
  function easeInQuad(t: number) {
    return t * t
  }

  function updateForcedBlink(dt: number, baseLeft: number, baseRight: number) {
    // Idle: count down delay to next blink.
    if (blinkState.phase === 'idle') {
      blinkState.delayMs = Math.max(0, blinkState.delayMs - dt)
      if (blinkState.delayMs === 0) {
        blinkState.phase = 'closing'
        blinkState.progress = 0
        blinkState.startLeft = baseLeft
        blinkState.startRight = baseRight
      }

      return { eyeLOpen: baseLeft, eyeROpen: baseRight }
    }

    // Closing: move toward zero with ease-out.
    if (blinkState.phase === 'closing') {
      blinkState.progress = Math.min(1, blinkState.progress + dt / blinkCloseDuration)
      const eased = easeOutQuad(blinkState.progress)
      const eyeLOpen = clamp01(blinkState.startLeft * (1 - eased))
      const eyeROpen = clamp01(blinkState.startRight * (1 - eased))

      if (blinkState.progress >= 1) {
        blinkState.phase = 'opening'
        blinkState.progress = 0
        blinkState.openDurationMs = randomBlinkOpenDuration()
      }

      return { eyeLOpen, eyeROpen }
    }

    // Opening: move back to the base with ease-in.
    blinkState.progress = Math.min(1, blinkState.progress + dt / blinkState.openDurationMs)
    const eased = easeInQuad(blinkState.progress)
    const eyeLOpen = clamp01(blinkState.startLeft * eased)
    const eyeROpen = clamp01(blinkState.startRight * eased)

    if (blinkState.progress >= 1) {
      resetBlinkState()
    }

    return { eyeLOpen, eyeROpen }
  }

  return (ctx) => {
    // ===== EXPRESSION OFF: MAIN-IDENTICAL BEHAVIOR =====
    // When the expression system is disabled, replicate the exact auto-blink
    // logic from main so that hookUpdate returns the same handled state and
    // the SDK eyeBlink/motion pipeline is not disrupted.
    if (!live2dExpressionEnabled?.value) {
      if (!ctx.isIdleMotion || ctx.handled)
        return

      const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
      const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

      // Auto-blink OFF: absolute write + markHandled (same as main).
      if (!ctx.live2dAutoBlinkEnabled.value) {
        resetBlinkState()
        ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), baseLeft)
        ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), baseRight)
        ctx.markHandled()
        return
      }

      // Force ON or eyeBlink null: timer blink + markHandled.
      if (ctx.live2dForceAutoBlinkEnabled.value || !ctx.internalModel.eyeBlink) {
        const safeDt = ctx.timeDelta * 1000 || 16
        const { eyeLOpen, eyeROpen } = updateForcedBlink(safeDt, baseLeft, baseRight)
        ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), eyeLOpen)
        ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), eyeROpen)
        ctx.markHandled()
        return
      }

      // SDK eyeBlink path: explicit call → read back → multiply by base → markHandled.
      ctx.internalModel.eyeBlink!.updateParameters(ctx.model, ctx.timeDelta / 1000)
      const blinkLeft = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      const blinkRight = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), clamp01(blinkLeft * baseLeft))
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), clamp01(blinkRight * baseRight))
      ctx.markHandled()
      return
    }

    // ===== EXPRESSION ON: MULTIPLY-MODULATE BEHAVIOR =====
    // Run during idle motion only (non-idle motions control eyes via curves).
    if (!ctx.isIdleMotion)
      return

    const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
    const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

    // Auto-blink OFF: apply manual base values only (multiply with current).
    if (!ctx.live2dAutoBlinkEnabled.value) {
      resetBlinkState()
      const currentLeft = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      const currentRight = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), clamp01(currentLeft * baseLeft))
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), clamp01(currentRight * baseRight))
      return
    }

    // Force OFF and SDK eyeBlink alive: should not happen when expression ON
    // (eyeBlink is nullified), but guard defensively — just apply multiplier.
    if (!ctx.live2dForceAutoBlinkEnabled.value && ctx.internalModel.eyeBlink != null) {
      resetBlinkState()
      const currentLeft = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      const currentRight = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), clamp01(currentLeft * baseLeft))
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), clamp01(currentRight * baseRight))
      return
    }

    // --- Force Auto Blink: stateful blink for models without idle blink curves ---

    const currentLeft = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number
    const currentRight = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen')) as number

    // Skip blink when eyes are already nearly/fully closed (e.g. by expression).
    const BLINK_THRESHOLD = 0.15
    if (blinkState.phase === 'idle' && currentLeft <= BLINK_THRESHOLD && currentRight <= BLINK_THRESHOLD) {
      resetBlinkState()
      return
    }

    // Track post-expression eye values during idle as the blink baseline.
    if (blinkState.phase === 'idle') {
      preBlinkLeft = currentLeft
      preBlinkRight = currentRight
    }

    // Advance blink timer.
    const wasActive = blinkState.phase !== 'idle'
    const safeDt = ctx.timeDelta * 1000 || 16
    const { eyeLOpen: blinkFactorL, eyeROpen: blinkFactorR } = updateForcedBlink(safeDt, 1.0, 1.0)

    // Blink cycle complete: restore exact pre-blink values.
    if (wasActive && blinkState.phase === 'idle') {
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), clamp01(preBlinkLeft * baseLeft))
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), clamp01(preBlinkRight * baseRight))
      return
    }

    // Idle: don't write (avoids feedback-loop decay).
    if (blinkState.phase === 'idle')
      return

    // Active blink: saved pre-blink values × blinkFactor.
    ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeLOpen'), clamp01(preBlinkLeft * blinkFactorL * baseLeft))
    ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamEyeROpen'), clamp01(preBlinkRight * blinkFactorR * baseRight))
  }
}

/**
 * Post-plugin that applies expression parameter overrides from the expression
 * store onto the Live2D model every frame.
 *
 * This plugin intentionally ignores `ctx.handled` so that expression values
 * are always applied on top of whatever the motion / blink plugins produced.
 * It also does NOT call `ctx.markHandled()` so it never blocks other plugins.
 */
export function useMotionUpdatePluginExpression(
  controller: ReturnType<typeof useExpressionController>,
): MotionManagerPlugin {
  return (ctx) => {
    // Always apply regardless of handled state – expressions layer on top.
    controller.applyExpressions(ctx.model)
  }
}

/**
 * Final-phase plugin that owns ParamMouthOpenY while speech is active and
 * smoothly cross-fades back to the motion-driven value when speech ends.
 *
 * `nowSpeaking` (not `mouthOpenSize > 0`) is the speech boundary, so silent
 * gaps between phonemes write 0 directly instead of triggering the release.
 */
export function useMotionUpdatePluginLipSync(
  mouthOpenSize: Ref<number>,
  nowSpeaking: Ref<boolean>,
): MotionManagerPlugin {
  // 200 ms covers a typical phoneme tail without lagging behind the next utterance.
  const RELEASE_DURATION_MS = 200

  let releaseRemainingMs = 0
  let lastForcedValue = 0

  // Smoothstep: 3t^2 - 2t^3, eases in/out with zero slope at endpoints.
  const smoothstep = (t: number) => t * t * (3 - 2 * t)

  return (ctx) => {
    if (nowSpeaking.value) {
      lastForcedValue = mouthOpenSize.value
      releaseRemainingMs = RELEASE_DURATION_MS
      ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamMouthOpenY'), mouthOpenSize.value)
      return
    }

    if (releaseRemainingMs <= 0)
      return

    releaseRemainingMs = Math.max(0, releaseRemainingMs - ctx.timeDelta * 1000)
    const blend = smoothstep(1 - releaseRemainingMs / RELEASE_DURATION_MS)

    // ParamMouthOpenY was already written by motion + expression plugins this frame.
    const motionValue = ctx.model.getParameterValueById(CubismFramework.getIdManager().getId('ParamMouthOpenY')) as number
    const blended = lastForcedValue * (1 - blend) + motionValue * blend

    ctx.model.setParameterValueById(CubismFramework.getIdManager().getId('ParamMouthOpenY'), blended)
  }
}
