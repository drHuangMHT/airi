import { createChatOrchestratorRuntimeMinimized } from '@proj-airi/core-agent'
import { nanoid } from 'nanoid'
import { ref, toRaw } from 'vue'

import { useChatSession } from './chat/session-store-minimized'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useLLM } from './llm'

export type { QueuedSendSnapshot, ChatOrchestratorSendOptions as SendOptions } from '@proj-airi/core-agent'

export function useChatOrchestrator() {
  const llmStore = useLLM()

  const chatSession = useChatSession()
  const contextObservability = useContextObservabilityStore()
  const { session, sessionId, sendMessage } = chatSession

  const sendLocked = ref(false)

  const runtime = createChatOrchestratorRuntimeMinimized({
    session: {
      getSessionMessages: () => session.value?.messages.map(message => toRaw(message)) ?? [],
      appendSessionMessage: (message) => {
        sendMessage(message.role, message)
      },
    },
    llm: {
      stream: llmStore.stream,
    },
    createId: nanoid,
    onLifecycle: record => contextObservability.recordLifecycle(record),
    turnLifecycle: {
      onBeforeContextFreeze: () => {
        sendLocked.value = true
      },
      onTurnReady: () => {
        sendLocked.value = false
      },
    },
  })

  async function ingest(
    sendingMessage: string,
  ) {
    return runtime.ingest(sendingMessage)
  }
  function setSession(id: string): boolean {
    if (sendLocked.value)
      return false
    sessionId.value = id
    return true
  }

  return {
    session,

    /** Signals whether user input is allowed. */
    sendLocked,
    ingest,
    setSession,

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
