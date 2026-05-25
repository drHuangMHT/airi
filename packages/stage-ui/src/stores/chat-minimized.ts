import type { ChatOrchestratorRuntimeState, ChatOrchestratorSendOptions } from '@proj-airi/core-agent'

import { createChatOrchestratorRuntime } from '@proj-airi/core-agent'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { ref, toRaw, watch } from 'vue'

import { Participant } from './chat_room'
import { createMinecraftContext } from './chat/context-providers'
import { useChatContextStore } from './chat/context-store'
import { useChatSessionStore } from './chat/session-store-minimized'
import { useChatStreamStore } from './chat/stream-store'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useLLM } from './llm'
import { useConsciousnessStore } from './modules/consciousness'
import { connectWsConnector } from './ws-exporter'

export type { QueuedSendSnapshot, ChatOrchestratorSendOptions as SendOptions } from '@proj-airi/core-agent'

const user = new Participant('user', 'user')
const assistant = new Participant('assistant', 'assistant')
const system = new Participant('system', 'system')
const generation = ref(0)
const ws_client = connectWsConnector()

assistant.registerMessageCallback((message) => {
  ws_client.send(JSON.stringify(message))
})

export function useChatOrchestratorStore() {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider } = storeToRefs(consciousnessStore)

  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const contextObservability = useContextObservabilityStore()
  const { activeSessionId, activeSession, saveAllSessions } = chatSession
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = ref(false)
  const pendingQueuedSendCount = ref(0)

  watch(activeSession, () => {
    const getTicket = () => activeSession.value?.[1].joinTicket()
    try {
      const userTicket = getTicket()
      if (userTicket)
        user.join(userTicket as any)
      const assistantTicket = getTicket()
      if (assistantTicket)
        assistant.join(assistantTicket as any)
      const systemTicket = getTicket()
      if (systemTicket)
        system.join(systemTicket as any)
    }
    catch {}
  })

  function syncRuntimeState(state: ChatOrchestratorRuntimeState) {
    sending.value = state.sending
    pendingQueuedSendCount.value = state.pendingQueuedSendCount
  }

  const runtime = createChatOrchestratorRuntime({
    session: {
      ensureSession: () => {},
      getSessionMessages: () => activeSession.value![1].messages.map(message => toRaw(message)),
      appendSessionMessage: (sessionId, message) => {
        if (message.role === 'assistant') {
          assistant.postMessageRaw(message)
          generation.value += 1
        }
        if (message.role === 'user')
          user.postMessageRaw(message)
        if (message.role === 'system')
          system.postMessageRaw(message)
      },
      getSessionGeneration: () => generation.value,
    },
    context: {
      ingest: envelope => chatContext.ingestContextMessage(envelope),
      snapshot: () => chatContext.getContextsSnapshot(),
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
    getActiveSessionId: () => activeSessionId.value,
    getActiveProvider: () => activeProvider.value,
    runtimeContextProviders: [
      createMinecraftContext,
    ],
    createId: nanoid,
    unwrapMessage: message => toRaw(message),
    onStateChange: syncRuntimeState,
    onLifecycle: record => contextObservability.recordLifecycle(record),
    onPromptProjection: payload => contextObservability.capturePromptProjection(payload),
  })

  runtime.hooks.onChatTurnComplete(() => saveAllSessions())

  watch(sending, (next) => {
    if (runtime.getSending() !== next)
      runtime.setSending(next)
  })

  async function ingest(
    sendingMessage: string,
    options: ChatOrchestratorSendOptions,
    targetSessionId?: string,
  ) {
    return runtime.ingest(sendingMessage, options, targetSessionId)
  }

  function cancelPendingSends(sessionId?: string) {
    runtime.cancelPendingSends(sessionId)
  }

  function getPendingQueuedSendSnapshot() {
    return runtime.getPendingQueuedSendSnapshot()
  }

  return {
    sending,
    pendingQueuedSendCount,

    ingest,
    cancelPendingSends,
    getPendingQueuedSendSnapshot,

    clearHooks: runtime.hooks.clearHooks,

    emitBeforeMessageComposedHooks: runtime.hooks.emitBeforeMessageComposedHooks,
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
