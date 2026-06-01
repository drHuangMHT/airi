import type { ChatOrchestratorSendOptions } from '@proj-airi/core-agent'

import { createChatOrchestratorRuntimeMinimized } from '@proj-airi/core-agent'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { ref, toRaw } from 'vue'

import { useChatSession } from './chat/session-store-minimized'
import { useChatStreamStore } from './chat/stream-store'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useLLM } from './llm'
import { useConsciousnessStore } from './modules/consciousness'

export type { QueuedSendSnapshot, ChatOrchestratorSendOptions as SendOptions } from '@proj-airi/core-agent'

const generation = ref(0)

export function useChatOrchestratorStore() {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider } = storeToRefs(consciousnessStore)

  const chatSession = useChatSession()
  const chatStream = useChatStreamStore()
  const contextObservability = useContextObservabilityStore()
  const { session, sessionId, sendMessage, setMessage } = chatSession
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = ref(false)
  const pendingQueuedSendCount = ref(0)

  function syncRuntimeState(state: any) {
    sending.value = state.sending
    pendingQueuedSendCount.value = state.pendingQueuedSendCount
  }

  const runtime = createChatOrchestratorRuntimeMinimized({
    session: {
      ensureSession: () => {},
      getSessionMessages: () => session.value?.messages.map(message => toRaw(message)) ?? [],
      appendSessionMessage: (sessionId, message) => {
        chatSession.setMessage(sessionId, [message], true)
      },
      getSessionGeneration: () => generation.value,
    },
    foregroundStream: {
      patch: (message) => {
        streamingMessage.value = message
      },
      reset: () => {
        streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
      },
    },
    llm: {
      stream: llmStore.stream,
    },
    getActiveProvider: () => activeProvider.value,
    createId: nanoid,
    onStateChange: syncRuntimeState,
    onLifecycle: record => contextObservability.recordLifecycle(record),
    onPromptProjection: payload => contextObservability.capturePromptProjection(payload),
  })

  runtime.hooks.onChatTurnComplete(() => saveAllSessions())

  async function ingest(
    sendingMessage: string,
    options: ChatOrchestratorSendOptions,
    targetSessionId: string,
  ) {
    return runtime.ingest(sendingMessage, options, targetSessionId)
  }

  return {
    sending,
    pendingQueuedSendCount,

    ingest,

    clearHooks: runtime.hooks.clearHooks,

    emitBeforeMessageComposedHooks: runtime.hooks.emitBeforeMessageComposeHooks,
    emitAfterMessageComposedHooks: runtime.hooks.emitAfterMessageComposedHooks,
    emitBeforeSendHooks: runtime.hooks.emitBeforeSendHooks,
    emitAfterSendHooks: runtime.hooks.emitAfterSendHooks,
    emitTokenLiteralHooks: runtime.hooks.emitTokenLiteralHooks,
    emitTokenSpecialHooks: runtime.hooks.emitTokenSpecialHooks,
    emitStreamEndHooks: runtime.hooks.emitStreamEndHooks,
    emitAssistantResponseEndHooks: runtime.hooks.emitAssistantResponseEndHooks,
    emitAssistantMessageHooks: runtime.hooks.emitAssistantMessageHooks,
    emitChatTurnCompleteHooks: runtime.hooks.emitChatTurnCompleteHooks,

    onBeforeMessageComposed: runtime.hooks.onBeforeMessageComposed,
    onAfterMessageComposed: runtime.hooks.onAfterMessageComposed,
    onBeforeSend: runtime.hooks.onBeforeSend,
    onAfterSend: runtime.hooks.onAfterSend,
    onTokenLiteral: runtime.hooks.onTokenLiteral,
    onTokenSpecial: runtime.hooks.onTokenSpecial,
    onStreamEnd: runtime.hooks.onStreamEnd,
    onAssistantResponseEnd: runtime.hooks.onAssistantResponseEnd,
    onAssistantMessage: runtime.hooks.onAssistantMessage,
    onChatTurnComplete: runtime.hooks.onChatTurnComplete,
  }
}
