import { AudioAnalyzer } from '@proj-airi/multimodal-core'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { useSettingsAudioDevice } from './settings'

const audioContext = shallowRef<AudioContext>(new AudioContext())
export function useAudioContext() {
  const { stream, enabled } = storeToRefs(useSettingsAudioDevice())

  const audioAnalyzer = new AudioAnalyzer()
  const normalized = ref(0)
  audioAnalyzer.onAnalyzerUpdate((volume) => {
    normalized.value = Math.min(1, (volume ?? 0) / 100)
  })

  let source: MediaStreamAudioSourceNode | undefined

  function teardown() {
    try {
      source?.disconnect()
    }
    catch { }
    source = undefined
    audioAnalyzer.stopAnalyzer()
  }

  async function setup() {
    teardown()
    if (!enabled.value || !stream.value)
      return
    const ctx = audioContext.value
    if (ctx.state === 'suspended')
      await ctx.resume()
    const analyser = audioAnalyzer.startAnalyzer(ctx)
    if (!analyser)
      return
    source = ctx.createMediaStreamSource(stream.value)
    source.connect(analyser)
  }

  watch([enabled, stream], () => setup(), { immediate: true })

  onScopeDispose(() => teardown())
  return {
    audioContext,
    volume: normalized,
  }
}

export const useSpeakingStore = defineStore('character-speaking', () => {
  const nowSpeakingAvatarBorderOpacityMin = 30
  const nowSpeakingAvatarBorderOpacityMax = 100
  const mouthOpenSize = ref(0)
  const nowSpeaking = ref(false)

  const nowSpeakingAvatarBorderOpacity = computed<number>(() => {
    if (!nowSpeaking.value)
      return nowSpeakingAvatarBorderOpacityMin

    return ((nowSpeakingAvatarBorderOpacityMin
      + (nowSpeakingAvatarBorderOpacityMax - nowSpeakingAvatarBorderOpacityMin) * mouthOpenSize.value) / 100)
  })

  return {
    mouthOpenSize,
    nowSpeaking,
    nowSpeakingAvatarBorderOpacity,
  }
})
