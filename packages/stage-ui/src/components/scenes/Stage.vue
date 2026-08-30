<script setup lang="ts">
import { sleep } from '@moeru/std'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onUnmounted, ref, useTemplateRef } from 'vue'

import { initIOTracer } from '../../composables/use-io-tracer'
import { useSpeechPipelineAnalytics } from '../../composables/use-speech-pipeline-analytics'
import { useAudioContext } from '../../stores/audio'
import { useBackgroundStore } from '../../stores/background'
import { useChatOrchestrator } from '../../stores/chat-minimized'
import { useLlmStreamingControlStore } from '../../stores/llm-streaming-control'
import { useSettingsStage } from '../../stores/settings'

const props = withDefaults(defineProps<{
  paused?: boolean
}>(), { paused: false, scale: 1 })

const emit = defineEmits<{
  transparencyChange: [isTransparent: boolean]
}>()
const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const isCursorPosTransparent = defineModel<boolean>('isCursorPosTransparent', { default: false })

const { currentRenderer } = storeToRefs(useSettingsStage())

const { audioContext } = useAudioContext()

const { onBeforeMessageComposed } = useChatOrchestrator()
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

const stageRef = useTemplateRef('stageRef')

const backgroundStore = useBackgroundStore()
const { activeBackgroundUrl } = storeToRefs(backgroundStore)

const streamingControl = useLlmStreamingControlStore()

chatHookCleanups.push(streamingControl.onSignal(async (signal) => {
  if (signal.type === 'delay') {
    // eslint-disable-next-line no-console
    console.debug('delay detected', signal.seconds)
    await sleep(signal.seconds * 1000)
  }
}))

initIOTracer()
useSpeechPipelineAnalytics()

chatHookCleanups.push(onBeforeMessageComposed(async () => {
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
  chatHookCleanups.forEach(dispose => dispose?.())
  viewUpdateCleanups.forEach(dispose => dispose?.())
})

defineExpose({
  canvasElement: () => stageRef.value?.canvasElement(),
  captureFrame,
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
      <component
        :is="currentRenderer.stage" ref="stageRef"
        v-model:state="componentState"
        v-model:is-cursor-pos-transparent="isCursorPosTransparent"
        :paused="props.paused"
        @transparency-change="(v:boolean) => emit('transparencyChange', v)"
      >
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
