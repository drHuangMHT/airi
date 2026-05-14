import type { WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message, ToolMessage } from '@xsai/shared-chat'

import type { ChatAssistantMessage, ChatSlices, ChatStreamEventContext, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from './llm'
import type { Content, MessageTransformer } from './message-transform'

import { IOAttributes, IOEvents, IOSpanNames, IOSubsystems } from '@proj-airi/stage-shared'
import { createQueue } from '@proj-airi/stream-kit'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, toRaw } from 'vue'

import { useAnalytics } from '../composables'
import { useLlmMarkerParser } from '../composables/llm-marker-parser'
import { categorizeResponse, createStreamingCategorizer } from '../composables/response-categoriser'
import { activeTurnSpan, startSpan } from '../composables/use-io-tracer'
import { extractMessageText, isCloudSyncableMessage } from '../libs/chat-sync'
import { formatContextPromptText } from './chat/context-prompt'
import { createMinecraftContext } from './chat/context-providers'
import { useChatContextStore } from './chat/context-store'
import { formatTimePrefix } from './chat/datetime-prefix'
import { createChatHooks } from './chat/hooks'
import { useChatSessionStore } from './chat/session-store'
import { useChatStreamStore } from './chat/stream-store'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useLLM } from './llm'
import { SupportedContentType } from './message-transform'
import { useAiriCardStore } from './modules/airi-card'
import { useAutonomousArtistryStore } from './modules/artistry-autonomous'
import { useConsciousnessStore } from './modules/consciousness'

// updateUI structuredClones the whole message, which can stall the main thread
// when streams emit token-per-event. Shared by the parser's literal threshold and
// the reasoning-delta throttle so both refresh at the same cadence.
const STREAMING_UI_FLUSH_CHUNK_SIZE = 24

function cloneStreamingMessage(message: StreamingAssistantMessage): StreamingAssistantMessage {
  try {
    return structuredClone(message)
  }
  catch {
    return JSON.parse(JSON.stringify(message)) as StreamingAssistantMessage
  }
}

interface SendOptions {
  model: string
  chatProvider: ChatProvider
  providerConfig?: Record<string, unknown>
  attachments?: { type: 'image', data: string, mimeType: string }[]
  tools?: StreamOptions['tools']
  input?: WebSocketEventInputs
}

interface ForkOptions {
  fromSessionId?: string
  atIndex?: number
  reason?: string
  hidden?: boolean
}

interface QueuedSend {
  userText: string
  options: SendOptions
  generation: number
  sessionId: string
  cancelled?: boolean
  deferred: {
    resolve: () => void
    reject: (error: unknown) => void
  }
}

export interface QueuedSendSnapshot {
  sessionId: string
  generation: number
  cancelled: boolean
  messagePreview: string
  hasAttachments: boolean
  inputType?: WebSocketEventInputs['type']
}

export const useChatOrchestratorStore = defineStore('chat-orchestrator', () => {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const artistryAutonomousStore = useAutonomousArtistryStore()
  const { activeProvider } = storeToRefs(consciousnessStore)
  const { trackFirstMessage } = useAnalytics()

  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const cardStore = useAiriCardStore()
  const contextObservability = useContextObservabilityStore()
  const { activeSessionId } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = ref(false)
  const pendingQueuedSends = ref<QueuedSend[]>([])
  const pendingQueuedSendCount = computed(() => pendingQueuedSends.value.length)
  const hooks = createChatHooks()

  const sendQueue = createQueue<QueuedSend>({
    handlers: [
      async ({ data }) => {
        const { userText: sendingMessage, options, generation, deferred, sessionId, cancelled } = data

        if (cancelled)
          return

        if (chatSession.getSessionGeneration(sessionId) !== generation) {
          deferred.reject(new Error('Chat session was reset before send could start'))
          return
        }

        try {
          await performSend(sendingMessage, options, generation, sessionId)
          deferred.resolve()
        }
        catch (error) {
          deferred.reject(error)
        }
      },
    ],
  })

  sendQueue.on('enqueue', (queuedSend) => {
    pendingQueuedSends.value.push(queuedSend)
  })

  sendQueue.on('dequeue', (queuedSend) => {
    pendingQueuedSends.value = pendingQueuedSends.value.filter(item => item !== queuedSend)
  })

  async function performSend(
    userText: string,
    options: SendOptions,
    generation: number,
    sessionId: string,
  ) {
    if (!userText && !options.attachments?.length)
      return

    chatSession.ensureSession(sessionId)

    // Datetime is no longer injected through the side-channel context store.
    // It is applied at message-assembly time (see below) as a system-prompt
    // date anchor + per-message [HH:MM] prefixes, which is more KV-cache
    // friendly and less prone to weak models echoing timestamps verbatim.
    const minecraftContext = createMinecraftContext()
    if (minecraftContext)
      chatContext.ingestContextMessage(minecraftContext)

    const sendingCreatedAt = Date.now()
    // TODO: Expire or prune stale runtime contexts from disconnected services before composing.
    // The Minecraft page already times out service liveness locally, but the shared chat context
    // snapshot can still retain the last runtime context:update until we add cross-store expiry.
    const streamingMessageContext: ChatStreamEventContext = {
      message: { role: 'user', content: userText, createdAt: sendingCreatedAt, id: nanoid() },
      contexts: chatContext.getContextsSnapshot(),
      composedMessage: [],
      input: options.input,
    }
    contextObservability.recordLifecycle({
      phase: 'before-compose',
      channel: 'chat',
      sessionId,
      textPreview: userText,
      details: {
        contexts: streamingMessageContext.contexts,
      },
    })

    const isStaleGeneration = () => chatSession.getSessionGeneration(sessionId) !== generation
    const shouldAbort = () => isStaleGeneration()
    if (shouldAbort())
      return

    sending.value = true
    let hadExistingTurn = false

    const isForegroundSession = () => sessionId === activeSessionId.value

    const assistanceMessageStub: StreamingAssistantMessage = { role: 'assistant', content: '', slices: [], tool_results: [], createdAt: Date.now(), id: nanoid() }

    const updateUI = () => {
      if (isForegroundSession()) {
        streamingMessage.value = cloneStreamingMessage(assistanceMessageStub)
      }
    }

    updateUI()
    trackFirstMessage()

    try {
      await hooks.emitBeforeMessageComposedHooks(userText, streamingMessageContext)

      const contentParts: Content[] = [{ type: SupportedContentType.TEXT, text: userText }]

      const _attachmentTransform: MessageTransformer = {
        async transform(message, context) {
          for (const attachment of options.attachments ?? []) {
            if (attachment.type === 'image') {
              const content: Content = {
                type: SupportedContentType.IMAGE,
                image_url: {
                  url: `data:${attachment.mimeType};base64,${attachment.data}`,
                },
              }
              contentParts.push(content)
            }
          }
          return { message, context }
        },
      }

      // const finalContent = contentParts.length > 1 ? contentParts : sendingMessage
      // if (!streamingMessageContext.input) {
      //   streamingMessageContext.input = {
      //     type: 'input:text',
      //     data: {
      //       text: sendingMessage,
      //     },
      //   }
      // }

      if (shouldAbort())
        return

      const userMessageId = nanoid()
      const userMessage = {
        role: 'user' as const,
        content: contentParts,
        createdAt: sendingCreatedAt,
        id: userMessageId,
      }
      chatSession.appendSessionMessage(sessionId, userMessage)
      // Cloud sync v1: only the raw text part round-trips; image attachments
      // and other non-text parts stay local. The session-store guard handles
      // anonymous / unmapped sessions and offline state.
      if (isCloudSyncableMessage(userMessage)) {
        void chatSession.pushMessageToCloud(sessionId, {
          id: userMessageId,
          role: 'user',
          content: userText,
        })
      }
      const sessionMessagesForSend = chatSession.getSessionMessages(sessionId)

      // --------------------------------
      // Cinematic Autonomy (Autonomous Artist)
      // Trigger now only if in user-centric mode. Assistant-centric runs after response is complete.
      const autonomousTarget = cardStore.activeCard?.extensions?.airi?.modules?.artistry?.autonomousTarget || 'user'
      if (autonomousTarget === 'user') {
        void artistryAutonomousStore.runArtistTask(userText, sessionMessagesForSend as any)
      }
      // --------------------------------

      const categorizer = createStreamingCategorizer(activeProvider.value)
      let streamPosition = 0

      const parser = useLlmMarkerParser({
        onLiteral: async (literal) => {
          if (shouldAbort())
            return

          categorizer.consume(literal)

          const speechOnly = categorizer.filterToSpeech(literal, streamPosition)
          streamPosition += literal.length

          if (speechOnly.trim()) {
            assistanceMessageStub.content += speechOnly

            await hooks.emitTokenLiteralHooks(speechOnly, streamingMessageContext)

            const lastSlice = assistanceMessageStub.slices.at(-1)
            if (lastSlice?.type === 'text') {
              lastSlice.text += speechOnly
            }
            else {
              assistanceMessageStub.slices.push({
                type: 'text',
                text: speechOnly,
              })
            }
            updateUI()
          }
        },
        onSpecial: async (special) => {
          if (shouldAbort())
            return

          await hooks.emitTokenSpecialHooks(special, streamingMessageContext)
        },
        onEnd: async (fullText) => {
          if (isStaleGeneration())
            return

          const finalCategorization = categorizeResponse(fullText, activeProvider.value)

          const reasoningContentField = assistanceMessageStub.categorization?.reasoning?.trim()
          assistanceMessageStub.categorization = {
            speech: finalCategorization.speech,
            reasoning: reasoningContentField || finalCategorization.reasoning,
          }
          updateUI()
        },
        minLiteralEmitLength: STREAMING_UI_FLUSH_CHUNK_SIZE,
      })

      const toolCallQueue = createQueue<ChatSlices>({
        handlers: [
          async (ctx) => {
            if (shouldAbort())
              return
            if (ctx.data.type === 'tool-call') {
              assistanceMessageStub.slices.push(ctx.data)
              updateUI()
              return
            }

            if (ctx.data.type === 'tool-call-result') {
              assistanceMessageStub.tool_results.push(ctx.data)
              updateUI()
            }
          },
        ],
      })

      // Inject `[YYYY-MM-DD HH:MM]` prefix only into user messages, derived
      // from their persisted `createdAt`. Assistant messages stay clean —
      // otherwise the model learns the format and mirrors it back into its
      // own replies (e.g. `[2026-05-09 00:23] > ...`). The model still reads
      // "today" from the latest user message, and the system prompt stays
      // 100% static for permanent KV-cache reuse. Legacy entries without a
      // persisted `createdAt` fall back to "now" rather than a fabricated
      // older timestamp.
      // See `./chat/datetime-prefix.ts` for the rationale.
      const nowTs = Date.now()

      const newMessages = sessionMessagesForSend.map((msg) => {
        const { context: _context, id: _id, createdAt, ...withoutContext } = msg
        const rawMessage = toRaw(withoutContext)

        if (rawMessage.role === 'user') {
          return prependTextToContent(rawMessage, formatTimePrefix(createdAt ?? nowTs))
        }

        if (rawMessage.role === 'assistant') {
          const { slices: _slices, tool_results: _toolResults, categorization: _categorization, ...rest } = rawMessage as ChatAssistantMessage
          return toRaw(rest)
        }

        return rawMessage
      })

      const contextsSnapshot = chatContext.getContextsSnapshot()
      const contextPromptText = formatContextPromptText(contextsSnapshot)
      if (contextPromptText) {
        // Merge context into the latest user message instead of inserting a
        // separate user message, which would create consecutive same-role
        // messages forbidden by some providers (e.g. Anthropic → 400 error).
        // Appending at the end keeps the static history prefix stable for
        // LLM KV-cache reuse.
        // See: https://github.com/moeru-ai/airi/issues/1539
        const lastMessage = newMessages.at(-1)
        if (lastMessage && lastMessage.role === 'user') {
          // Append context after the user's content, separated by a newline.
          // Keeping it at the end of the last message preserves the static
          // history prefix for LLM KV-cache reuse.
          const existingParts = typeof lastMessage.content === 'string'
            ? [{ type: 'text' as const, text: lastMessage.content }]
            : lastMessage.content

          lastMessage.content = [
            ...existingParts,
            { type: 'text' as const, text: `\n${contextPromptText}` },
          ]
        }

        contextObservability.recordLifecycle({
          phase: 'prompt-context-built',
          channel: 'chat',
          sessionId,
          details: {
            contexts: contextsSnapshot,
            promptText: contextPromptText,
          },
        })
      }

      streamingMessageContext.composedMessage = newMessages as Message[]
      contextObservability.capturePromptProjection({
        sessionId,
        message: userText,
        contexts: contextsSnapshot,
        promptMessage: undefined,
        composedMessage: newMessages as Message[],
      })
      contextObservability.recordLifecycle({
        phase: 'after-compose',
        channel: 'chat',
        sessionId,
        textPreview: userText,
        details: {
          composedMessage: newMessages,
        },
      })

      await hooks.emitAfterMessageComposedHooks(userText, streamingMessageContext)
      await hooks.emitBeforeSendHooks(userText, streamingMessageContext)

      let fullText = ''
      const headers = (options.providerConfig?.headers || {}) as Record<string, string>

      if (shouldAbort())
        return

      hadExistingTurn = !!activeTurnSpan.value
      if (!hadExistingTurn)
        activeTurnSpan.value = startSpan(IOSpanNames.InteractionTurn)

      const llmSpan = startSpan(IOSpanNames.LLMInference, activeTurnSpan.value, {
        [IOAttributes.Subsystem]: IOSubsystems.LLM,
        [IOAttributes.GenAIRequestModel]: options.model,
      })
      const llmRequestTs = performance.now()
      let llmFirstTokenEmitted = false

      try {
        await llmStore.stream(options.model, options.chatProvider, newMessages as Message[], {
          headers,
          tools: options.tools,
          // NOTICE: xsai stream may emit `finish` before tool steps continue, so keep waiting until
          // the final non-tool finish to avoid ending the chat turn with no assistant reply.
          waitForTools: true,
          captureToolErrors: true,
          onStreamEvent: async (event: StreamEvent) => {
            switch (event.type) {
              case 'tool-call':
                toolCallQueue.enqueue({
                  type: 'tool-call',
                  toolCall: event,
                })

                break
              case 'tool-result':
                toolCallQueue.enqueue({
                  type: 'tool-call-result',
                  id: event.toolCallId,
                  result: event.result,
                })

                break
              case 'tool-error':
                toolCallQueue.enqueue({
                  type: 'tool-call-result',
                  id: event.toolCallId,
                  isError: true,
                  result: event.result,
                })

                break
              case 'text-delta':
                if (!llmFirstTokenEmitted) {
                  llmFirstTokenEmitted = true
                  llmSpan.addEvent(IOEvents.LLMFirstToken, {
                    [IOAttributes.LLM_TTFT]: performance.now() - llmRequestTs,
                  })
                }
                fullText += event.text
                await parser.consume(event.text)
                break
              case 'reasoning-delta': {
                if (shouldAbort())
                  return

                const { reasoning = '' } = assistanceMessageStub.categorization ?? {}
                const nextReasoning = reasoning + event.text
                assistanceMessageStub.categorization = {
                  // Mirror in-flight text content so categorization stays shape-consistent with onEnd.
                  speech: typeof assistanceMessageStub.content === 'string' ? assistanceMessageStub.content : '',
                  reasoning: nextReasoning,
                }
                // Match text-delta's batching cadence; first chunk fires so the panel appears immediately.
                const crossesBoundary
                  = Math.floor(nextReasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
                    > Math.floor(reasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
                if (!reasoning || crossesBoundary)
                  updateUI()
                break
              }
              case 'finish':
                break
              case 'error':
                throw event.error ?? new Error('Stream error')
            }
          },
        })

        llmSpan.setAttribute(IOAttributes.LLMTextLength, fullText.length)
      }
      finally {
        // TODO: Record errors on llmSpan
        llmSpan.end()
      }

      await parser.end()

      if (!isStaleGeneration() && assistanceMessageStub.slices.length > 0) {
        const finalAssistant = toRaw(assistanceMessageStub)
        chatSession.appendSessionMessage(sessionId, finalAssistant)
        if (isCloudSyncableMessage(finalAssistant) && finalAssistant.id) {
          void chatSession.pushMessageToCloud(sessionId, {
            id: finalAssistant.id,
            role: 'assistant',
            content: extractMessageText(finalAssistant),
          })
        }
      }

      await hooks.emitStreamEndHooks(streamingMessageContext)
      await hooks.emitAssistantResponseEndHooks(fullText, streamingMessageContext)

      await hooks.emitAfterSendHooks(userText, streamingMessageContext)
      await hooks.emitAssistantMessageHooks({ ...assistanceMessageStub }, fullText, streamingMessageContext)
      await hooks.emitChatTurnCompleteHooks({
        output: { ...assistanceMessageStub },
        outputText: fullText,
        toolCalls: sessionMessagesForSend.filter(msg => msg.role === 'tool') as ToolMessage[],
      }, streamingMessageContext)

      // --- AUTONOMOUS ARTISTRY HOOK (ASSISTANT-CENTRIC) ---
      const artistry = cardStore.activeCard?.extensions?.airi?.modules?.artistry
      if (artistry?.autonomousEnabled && artistry?.autonomousTarget === 'assistant') {
        void artistryAutonomousStore.runArtistTask(fullText, sessionMessagesForSend as any)
      }
      // ---------------------------------------------------

      if (isForegroundSession()) {
        streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
      }
    }
    catch (error) {
      console.error('Error sending message:', error)
      throw error
    }
    finally {
      if (!hadExistingTurn && activeTurnSpan.value) {
        activeTurnSpan.value.end()
        activeTurnSpan.value = undefined
      }
      sending.value = false
    }
  }

  async function ingest(
    userText: string,
    options: SendOptions,
    targetSessionId?: string,
  ) {
    const sessionId = targetSessionId || activeSessionId.value
    const generation = chatSession.getSessionGeneration(sessionId)

    return new Promise<void>((resolve, reject) => {
      sendQueue.enqueue({
        userText,
        options,
        generation,
        sessionId,
        deferred: { resolve, reject },
      })
    })
  }

  async function ingestOnFork(
    sendingMessage: string,
    options: SendOptions,
    forkOptions?: ForkOptions,
  ) {
    const baseSessionId = forkOptions?.fromSessionId ?? activeSessionId.value
    if (!forkOptions)
      return ingest(sendingMessage, options, baseSessionId)

    const forkSessionId = await chatSession.forkSession({
      fromSessionId: baseSessionId,
      atIndex: forkOptions.atIndex,
      reason: forkOptions.reason,
      hidden: forkOptions.hidden,
    })
    return ingest(sendingMessage, options, forkSessionId || baseSessionId)
  }

  function cancelPendingSends(sessionId?: string) {
    for (const queued of pendingQueuedSends.value) {
      if (sessionId && queued.sessionId !== sessionId)
        continue

      queued.cancelled = true
      queued.deferred.reject(new Error('Chat session was reset before send could start'))
    }

    pendingQueuedSends.value = sessionId
      ? pendingQueuedSends.value.filter(item => item.sessionId !== sessionId)
      : []
  }

  function getPendingQueuedSendSnapshot() {
    return pendingQueuedSends.value.map(queued => ({
      sessionId: queued.sessionId,
      generation: queued.generation,
      cancelled: !!queued.cancelled,
      messagePreview: queued.userText.slice(0, 120),
      hasAttachments: !!queued.options.attachments?.length,
      inputType: queued.options.input?.type,
    } satisfies QueuedSendSnapshot))
  }

  return {
    sending,
    pendingQueuedSendCount,

    ingest,
    ingestOnFork,
    cancelPendingSends,
    getPendingQueuedSendSnapshot,

    clearHooks: hooks.clearHooks,

    emitBeforeMessageComposedHooks: hooks.emitBeforeMessageComposedHooks,
    emitAfterMessageComposedHooks: hooks.emitAfterMessageComposedHooks,
    emitBeforeSendHooks: hooks.emitBeforeSendHooks,
    emitAfterSendHooks: hooks.emitAfterSendHooks,
    emitTokenLiteralHooks: hooks.emitTokenLiteralHooks,
    emitTokenSpecialHooks: hooks.emitTokenSpecialHooks,
    emitStreamEndHooks: hooks.emitStreamEndHooks,
    emitAssistantResponseEndHooks: hooks.emitAssistantResponseEndHooks,
    emitAssistantMessageHooks: hooks.emitAssistantMessageHooks,
    emitChatTurnCompleteHooks: hooks.emitChatTurnCompleteHooks,

    onBeforeMessageComposed: hooks.onBeforeMessageComposed,
    onAfterMessageComposed: hooks.onAfterMessageComposed,
    onBeforeSend: hooks.onBeforeSend,
    onAfterSend: hooks.onAfterSend,
    onTokenLiteral: hooks.onTokenLiteral,
    onTokenSpecial: hooks.onTokenSpecial,
    onStreamEnd: hooks.onStreamEnd,
    onAssistantResponseEnd: hooks.onAssistantResponseEnd,
    onAssistantMessage: hooks.onAssistantMessage,
    onChatTurnComplete: hooks.onChatTurnComplete,
  }
})
