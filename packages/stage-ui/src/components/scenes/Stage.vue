<script setup lang="ts">
import type { Live2DLipSync, Live2DLipSyncOptions } from '@proj-airi/model-driver-lipsync'
import type { Profile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'

import type { EmotionPayload } from '../../constants/emotions'

import { sleep } from '@moeru/std'
import { createLive2DLipSync } from '@proj-airi/model-driver-lipsync'
import { wlipsyncProfile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { createQueue } from '@proj-airi/stream-kit'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { initIOTracer } from '../../composables/use-io-tracer'
import { useSpeechPipelineAnalytics } from '../../composables/use-speech-pipeline-analytics'
import { Emotion, EMOTION_EmotionMotionName_value, EMOTION_VRMExpressionName_value, EmotionThinkMotionName } from '../../constants/emotions'
import { useAudioContext, useSpeakingStore } from '../../stores/audio'
import { useBackgroundStore } from '../../stores/background'
import { useChatOrchestrator } from '../../stores/chat-minimized'
import { useLlmStreamingControlStore } from '../../stores/llm-streaming-control'
import { useSettings, useSettingsStage } from '../../stores/settings'

const props = withDefaults(defineProps<{
  paused?: boolean
}>(), { paused: false, scale: 1 })

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const { currentRenderer } = storeToRefs(useSettingsStage())

const settingsStore = useSettings()
const {
  stageModelRenderer,
} = storeToRefs(settingsStore)
const { mouthOpenSize, nowSpeaking } = storeToRefs(useSpeakingStore())
const { audioContext } = useAudioContext()

const { onBeforeMessageComposed, onBeforeSend } = useChatOrchestrator()
const chatHookCleanups: Array<() => void> = []
// WORKAROUND: clear previous handlers on unmount to avoid duplicate calls when this component remounts.
//             We keep per-hook disposers instead of wiping the global chat hooks to play nicely with
//             cross-window broadcast wiring.
const viewUpdateCleanups: Array<() => void> = []

// Caption + Presentation broadcast channels
type CaptionChannelEvent
  = | { type: 'caption-speaker', text: string }
    | { type: 'caption-assistant', text: string }
const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
const assistantCaption = ref('')

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }
const { post: postPresent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

const lipSyncStarted = ref(false)
const lipSyncLoopId = ref<number>()
const live2dLipSync = ref<Live2DLipSync>()
const live2dLipSyncOptions: Live2DLipSyncOptions = { mouthUpdateIntervalMs: 50, mouthLerpWindowMs: 50 }

const stageRef = useTemplateRef('stageRef')

const backgroundStore = useBackgroundStore()
const { activeBackgroundUrl } = storeToRefs(backgroundStore)

const currentMotion = ref<any>(null)

const emotionsQueue = createQueue<EmotionPayload>({
  handlers: [
    async (ctx) => {
      if (stageModelRenderer.value === 'vrm') {
        // console.debug('VRM emotion anime: ', ctx.data)
        const value = EMOTION_VRMExpressionName_value[ctx.data.name]
        if (!value)
          return

        await (stageRef.value! as any).setExpression(value, ctx.data.intensity)
      }
      else if (stageModelRenderer.value === 'live2d') {
        currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
      }
      else if (stageModelRenderer.value === 'spine') {
        (stageRef.value! as any).setEmotion!(ctx.data.name, ctx.data.intensity)
      }
    },
  ],
})

const streamingControl = useLlmStreamingControlStore()

function toStageEmotionPayload(payload: { name: string, intensity: number }): EmotionPayload | undefined {
  switch (payload.name) {
    case 'happy':
      return { name: Emotion.Happy, intensity: payload.intensity }
    case 'sad':
      return { name: Emotion.Sad, intensity: payload.intensity }
    case 'angry':
      return { name: Emotion.Angry, intensity: payload.intensity }
    case 'think':
      return { name: Emotion.Think, intensity: payload.intensity }
    case 'surprised':
      return { name: Emotion.Surprise, intensity: payload.intensity }
    case 'awkward':
      return { name: Emotion.Awkward, intensity: payload.intensity }
    case 'question':
      return { name: Emotion.Question, intensity: payload.intensity }
    case 'curious':
      return { name: Emotion.Curious, intensity: payload.intensity }
    case 'neutral':
      return { name: Emotion.Neutral, intensity: payload.intensity }
    default:
      return undefined
  }
}

chatHookCleanups.push(streamingControl.onSignal(async (signal) => {
  if (signal.type === 'act') {
    const act = normalizeActPayload(signal.payload)
    if (act.motion && stageModelRenderer.value === 'live2d') {
      currentMotion.value = { group: act.motion }
      return
    }
    if (act.emotion) {
      const emotion = toStageEmotionPayload(act.emotion)
      if (!emotion)
        return

      // eslint-disable-next-line no-console
      console.debug('emotion detected', emotion)
      emotionsQueue.enqueue(emotion)
    }
    return
  }

  if (signal.type === 'delay') {
    // eslint-disable-next-line no-console
    console.debug('delay detected', signal.seconds)
    await sleep(signal.seconds * 1000)
  }
}))

const lipSyncNode = ref<AudioNode>()

initIOTracer()
useSpeechPipelineAnalytics()

function startLipSyncLoop() {
  if (lipSyncLoopId.value)
    return

  const tick = () => {
    if (!nowSpeaking.value || !live2dLipSync.value) {
      mouthOpenSize.value = 0
    }
    else {
      mouthOpenSize.value = live2dLipSync.value.getMouthOpen()
    }
    lipSyncLoopId.value = requestAnimationFrame(tick)
  }

  lipSyncLoopId.value = requestAnimationFrame(tick)
}

function stopLipSyncLoop() {
  if (lipSyncLoopId.value) {
    cancelAnimationFrame(lipSyncLoopId.value)
    lipSyncLoopId.value = undefined
  }

  mouthOpenSize.value = 0
}

function resetLive2dLipSync() {
  stopLipSyncLoop()

  try {
    lipSyncNode.value?.disconnect()
  }
  catch {

  }

  lipSyncNode.value = undefined
  live2dLipSync.value = undefined
  lipSyncStarted.value = false
}

function syncLipSyncLoop() {
  if (stageModelRenderer.value === 'live2d' && !props.paused && lipSyncStarted.value) {
    startLipSyncLoop()
    return
  }

  stopLipSyncLoop()
}

async function setupLipSync() {
  if (stageModelRenderer.value !== 'live2d') {
    resetLive2dLipSync()
    return
  }

  if (lipSyncStarted.value)
    return

  try {
    const lipSync = await createLive2DLipSync(audioContext.value, wlipsyncProfile as Profile, live2dLipSyncOptions)
    live2dLipSync.value = lipSync
    lipSyncNode.value = lipSync.node
    await audioContext.value.resume()
    lipSyncStarted.value = true
    syncLipSyncLoop()
  }
  catch (error) {
    resetLive2dLipSync()
    console.error('Failed to setup Live2D lip sync', error)
  }
}

chatHookCleanups.push(onBeforeMessageComposed(async () => {
  await setupLipSync()
  // Reset assistant caption for a new message
  assistantCaption.value = ''
  try {
    postCaption({ type: 'caption-assistant', text: '' })
  }
  catch (error) {
    // BroadcastChannel may be closed if user navigated away - don't break flow
    console.warn('[Stage] Failed to post caption reset (channel may be closed)', { error })
  }
  try {
    postPresent({ type: 'assistant-reset' })
  }
  catch (error) {
    // BroadcastChannel may be closed if user navigated away - don't break flow
    console.warn('[Stage] Failed to post present reset (channel may be closed)', { error })
  }
}))

chatHookCleanups.push(onBeforeSend(async () => {
  currentMotion.value = { group: EmotionThinkMotionName }
}))

// Resume audio context on first user interaction (browser requirement)
let audioContextResumed = false
function resumeAudioContextOnInteraction() {
  if (audioContextResumed || !audioContext)
    return
  audioContextResumed = true
  audioContext.value.resume().catch(() => {
    // Ignore errors - audio context will be resumed when needed
  })
}

// Add event listeners for user interaction
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown']
  events.forEach((event) => {
    window.addEventListener(event, resumeAudioContextOnInteraction, { once: true, passive: true })
  })
}

watch([stageModelRenderer, () => props.paused], ([renderer]) => {
  if (renderer === 'godot') {
    componentState.value = 'mounted'
  }

  if (renderer !== 'live2d') {
    resetLive2dLipSync()
    return
  }

  syncLipSyncLoop()
}, { immediate: true })

function readRenderTargetRegionAtClientPoint(clientX: number, clientY: number, radius: number) {
  if (stageModelRenderer.value !== 'vrm')
    return null

  return (stageRef.value! as any).readRenderTargetRegionAtClientPoint?.(clientX, clientY, radius) ?? null
}

async function captureFrame() {
  const charBlob = await stageRef.value?.captureFrame()

  if (!activeBackgroundUrl.value || !charBlob)
    return charBlob

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return charBlob

    // Load background image
    const bgImg = new Image()
    bgImg.crossOrigin = 'anonymous'
    bgImg.src = activeBackgroundUrl.value
    await new Promise((resolve, reject) => {
      bgImg.onload = resolve
      bgImg.onerror = reject
    })

    // Load character frame
    const charImg = await createImageBitmap(charBlob)

    // Match canvas size to the captured frame (respects DPI/Render Scale)
    canvas.width = charImg.width
    canvas.height = charImg.height

    // Draw background with "cover" logic
    const scale = Math.max(canvas.width / bgImg.width, canvas.height / bgImg.height)
    const w = bgImg.width * scale
    const h = bgImg.height * scale
    const x = (canvas.width - w) / 2
    const y = (canvas.height - h) / 2

    ctx.drawImage(bgImg, x, y, w, h)

    // Draw character on top
    ctx.drawImage(charImg, 0, 0)

    return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  }
  catch (error) {
    console.error('[Stage] Failed to composite photo with background:', error)
    return charBlob // Fallback to character-only
  }
}

onUnmounted(() => {
  resetLive2dLipSync()
  chatHookCleanups.forEach(dispose => dispose?.())
  viewUpdateCleanups.forEach(dispose => dispose?.())
})

defineExpose({
  canvasElement: () => stageRef.value?.canvasElement(),
  captureFrame,
  readRenderTargetRegionAtClientPoint,
})
</script>

<template>
  <div relative h-full w-full>
    <!-- Scene Background Layer -->
    <div
      v-if="activeBackgroundUrl"
      :class="[
        'absolute left-0 top-0 z-0 h-full w-full',
        'transition-opacity duration-500',
      ]"
      :style="{
        backgroundImage: `url(${activeBackgroundUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }"
    />

    <div v-if="currentRenderer" relative h-full w-full>
      <component :is="currentRenderer.stage" ref="stageRef" v-model:state="componentState" :paused>
      <!-- <SpineScene
        v-if="stageModelRenderer === 'spine' && showStage"
        ref="spineSceneRef"
        v-model:state="componentState"
        min-w="50% <lg:full" min-h="100 sm:100"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :paused="paused"
        :premultiplied-alpha="spinePremultipliedAlpha"
        :default-mix-duration="spineDefaultMixDuration"
        :idle-animation-enabled="spineIdleAnimationEnabled"
        :max-fps="spineMaxFps"
        :render-scale="spineRenderScale"
      />
      <div
        v-if="stageModelRenderer === 'godot'"
        :class="[
          'h-full w-full',
          'flex items-center justify-center',
          'px-4 py-6',
        ]"
      >
        <div
          :class="[
            'w-96 max-w-full',
            'min-h-32',
            'flex items-center justify-center',
          ]"
        >
          <Callout label="Godot Stage (Experimental)">
            <p>Godot Stage (experimental) is running...</p>
          </Callout>
        </div>
      </div> -->
      </component>
    </div>
  </div>
</template>
