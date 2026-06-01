import type { StreamingAssistantMessage } from '../../types/chat'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'

import { useChatSessionStore } from './session-store-minimized'

export const useChatStreamStore = defineStore('chat-stream', () => {
  const chatSession = useChatSessionStore()
  const streamingMessage = ref<StreamingAssistantMessage>({ role: 'assistant', content: '', slices: [], tool_results: [], createdAt: Date.now() })

  function beginStream() {
    resetStream()
  }

  function appendStreamLiteral(literal: string) {
    streamingMessage.value.content += literal

    const lastSlice = streamingMessage.value.slices.at(-1)
    if (lastSlice?.type === 'text') {
      lastSlice.text += literal
      return
    }

    streamingMessage.value.slices.push({
      type: 'text',
      text: literal,
    })
  }

  function finalizeStream(fullText?: string) {
    if (streamingMessage.value.slices.length > 0)
      chatSession.sendMessage('assistant', { id: nanoid(), ...toRaw(streamingMessage.value) })
    if (fullText)
      streamingMessage.value.content = fullText
  }

  function resetStream() {
    streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [], createdAt: Date.now() }
  }

  return {
    streamingMessage,
    beginStream,
    appendStreamLiteral,
    finalizeStream,
    resetStream,
  }
})
