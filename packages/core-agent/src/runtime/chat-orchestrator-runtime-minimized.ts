import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { CommonContentPart as ContentPart, Message, ToolMessage } from '@xsai/shared-chat'

import type { AgentForegroundStreamPort } from '../contracts/stream-port'
import type { ChatHistoryItem, ChatStreamEventContext, ContextMessage, MicroTurn, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from '../types/llm'

import { createQueue } from '@proj-airi/stream-kit'

import { createChatHooks } from './agent-hooks'
import { useLlmmarkerParser } from './llm-marker-parser'
import { categorizeResponse, createStreamingCategorizer } from './response-categoriser'

const STREAMING_UI_FLUSH_CHUNK_SIZE = 24

function cloneStreamingMessage(message: StreamingAssistantMessage): StreamingAssistantMessage {
  try {
    return structuredClone(message)
  }
  catch {
    return JSON.parse(JSON.stringify(message)) as StreamingAssistantMessage
  }
}

/**
 * Options accepted by the chat orchestrator runtime for one user send.
 */
export interface ChatOrchestratorSendOptions {
  /** Provider model identifier used for the outbound LLM request. */
  model: string
  /** Concrete chat provider implementation selected by the caller. */
  chatProvider: ChatProvider
  /** Provider-specific request options, currently used for headers. */
  providerConfig?: Record<string, unknown>
  /** Image attachments appended to the user message content parts. no effect on minimized */
  attachments?: { type: 'image', data: string, mimeType: string }[]
  /** Tool definitions passed through to the LLM stream port. */
  tools?: StreamOptions['tools']
  /** Original transport input metadata used by bridge/devtools observers. */
  input?: ChatStreamEventContext['input']
}

/**
 * Serializable view of a queued send waiting to be processed.
 */
export interface QueuedSendSnapshot {
  /** Session that owns the queued send. */
  sessionId: string
  /** Session generation captured when the send was enqueued. */
  generation: number
  /** Whether the queued send has been rejected before execution. */
  cancelled: boolean
  /** First 120 characters of the pending user message. */
  messagePreview: string
  /** Whether the queued send carries image attachments. */
  hasAttachments: boolean
  /** Optional input event type for transport-originated sends. */
  inputType?: NonNullable<ChatStreamEventContext['input']>['type']
}

/**
 * Session operations required by the core chat orchestrator runtime.
 */
export interface ChatOrchestratorSessionPort {
  /** Ensures a session exists before messages are appended. */
  ensureSession: (sessionId: string) => void
  /** Returns chronological chat history for a session. */
  getSessionMessages: (sessionId: string) => ChatHistoryItem[]
  /** Appends a finalized user/assistant/tool history item. */
  appendSessionMessage: (sessionId: string, message: ChatHistoryItem) => void
  /** Returns a monotonic generation used to reject stale queued sends. */
  getSessionGeneration: (sessionId: string) => number
}

/**
 * LLM streaming boundary used by the core chat orchestrator runtime.
 */
export interface ChatOrchestratorLLMPort {
  /** Streams one composed chat request and emits normalized stream events. */
  stream: (model: string, chatProvider: ChatProvider, messages: Message[], options?: StreamOptions) => Promise<void>
}

/**
 * Lifecycle record emitted around prompt composition.
 */
export interface ChatOrchestratorLifecycleRecord {
  /** Composition phase being observed. */
  phase: 'before-compose' | 'prompt-context-built' | 'after-compose'
  /** Logical event channel for context observability. */
  channel: 'chat'
  /** Session associated with this send. */
  sessionId: string
  /** Optional compact preview of the user text. */
  textPreview?: string
  /** Phase-specific payload for devtools and diagnostics. */
  details?: unknown
}

/**
 * Prompt projection emitted after the runtime has composed provider messages.
 */
export interface ChatOrchestratorPromptProjection {
  /** Session associated with the projected prompt. */
  sessionId: string
  /** Raw user message text that triggered the prompt. */
  message: string
  /** Active context snapshot read during prompt composition. */
  contexts: Record<string, ContextMessage[]>
  /** Historical standalone context prompt shape, kept for compatibility. */
  promptMessage?: Message | null
  /** Provider-ready message array sent to the LLM port. */
  composedMessage?: Message[]
}

/**
 * Reactive state mirrored by UI facades.
 */
export interface ChatOrchestratorRuntimeState {
  /** Whether the runtime currently owns an active send. */
  sending: boolean
}

/**
 * Dependency surface used by the platform-agnostic chat orchestrator runtime.
 */
export interface ChatOrchestratorRuntimeDeps {
  /** Session persistence and generation guard port. */
  session: ChatOrchestratorSessionPort
  /** Foreground assistant stream port controlled by the UI facade. */
  foregroundStream: AgentForegroundStreamPort
  /** Provider-agnostic LLM streaming port. */
  llm: ChatOrchestratorLLMPort
  /** Returns the currently active provider ID for categorization policy. */
  getActiveProvider: () => string | undefined
  /** Clock used for persisted message timestamps. @default Date.now */
  now?: () => number
  /** Monotonic clock used for elapsed telemetry in milliseconds. @default performance.now */
  monotonicNow?: () => number
  /** ID factory used for persisted chat messages. @default crypto.randomUUID fallback */
  createId?: () => string
  /** Called whenever writable runtime state changes. */
  onStateChange?: (state: ChatOrchestratorRuntimeState) => void
  /** Called after a runtime-owned send completes or fails and `sending` has been cleared. */
  onSendSettled?: (event: { sessionId: string }) => void
  /** Called when a send starts and the first assistant placeholder is created. */
  onAssistantStreamingStarted?: () => void
  /** Called when a user message send begins. */
  onMessageSendStarted?: (event: {
    source: 'text' | 'voice'
    model: string
  }) => void
  /** Called immediately before the provider LLM request starts. */
  onLlmRequestStarted?: (event: {
    model: string
    provider: string
    hasVoice: boolean
  }) => void
  /** Called when the first text token arrives from the provider stream. */
  onLlmFirstToken?: (event: {
    model: string
    ttfbMs: number
  }) => void
  /** Called after the assistant stream is parsed and rendered into runtime state. */
  onAssistantResponseRendered?: (event: {
    model: string
    latencyMs: number
  }) => void
  /** Called after one user-to-assistant message round completes successfully. */
  onMessageRound?: (event: {
    durationMs: number
    hasVoice: boolean
    model: string
  }) => void
  /** Called for context/prompt lifecycle observability. */
  onLifecycle?: (record: ChatOrchestratorLifecycleRecord) => void
  /** Called with the final provider prompt projection. */
  onPromptProjection?: (payload: ChatOrchestratorPromptProjection) => void
  /** Called after the user message has been appended to session history. */
  onUserMessageAppend?: (event: {
    sessionId: string
    message: Extract<ChatHistoryItem, { role: 'user' }> & { id: string }
    messageText: string
  }) => void
  /** Called after the assistant message has been finalized into session history. */
  onAssistantMessageAppended?: (event: {
    sessionId: string
    message: StreamingAssistantMessage
    messageText: string
  }) => void
  /** Called after user turn persistence, before provider prompt composition. */
  onUserTurnReady?: (event: {
    messageText: string
    sessionMessages: ChatHistoryItem[]
  }) => void
  /** Called after assistant streaming and hook finalization. */
  onAssistantTurnReady?: (event: {
    messageText: string
    sessionMessages: ChatHistoryItem[]
  }) => void
}

/**
 * Platform-agnostic chat orchestrator runtime API.
 */
export interface ChatOrchestratorRuntime {
  /** Enqueues a user send for the target session, preserving FIFO order. */
  ingest: (sendingMessage: string, options: ChatOrchestratorSendOptions, sessionId: string) => Promise<void>
  hooks: ReturnType<typeof createChatHooks>
}

function defaultCreateId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Creates the core chat orchestrator runtime used behind UI facades.
 * Does not handle session switch during assistant message composition
 *
 * Use when:
 * - A platform wants AIRI chat send orchestration without Vue/Pinia coupling.
 * - Session, context, foreground stream, and LLM integrations are provided as adapters.
 *
 * Expects:
 * - Session messages are returned in chronological order.
 * - `foregroundStream.patch` replaces the visible streaming assistant message.
 *
 * Returns:
 * - A runtime with send queue APIs, hook registry, writable sending state, and queue snapshots.
 */
export function createChatOrchestratorRuntimeMinimized(deps: ChatOrchestratorRuntimeDeps): ChatOrchestratorRuntime {
  const hooks = createChatHooks()
  const now = deps.now ?? (() => Date.now())
  const monotonicNow = deps.monotonicNow ?? (() => globalThis.performance?.now?.() ?? Date.now())
  const createId = deps.createId ?? defaultCreateId

  let sending = false

  function emitStateChange() {
    deps.onStateChange?.({
      sending,
    })
  }

  function setSending(next: boolean) {
    if (sending === next)
      return
    sending = next
    emitStateChange()
  }

  function patchForegroundStream(message: StreamingAssistantMessage) {
    deps.foregroundStream.patch(cloneStreamingMessage(message))
  }

  function resetForegroundStream() {
    deps.foregroundStream.reset()
  }

  async function performSend(
    userText: string,
    options: ChatOrchestratorSendOptions,
    generation: number,
    sessionId: string,
  ) {
    if (!userText && !options.attachments?.length)
      return

    deps.session.ensureSession(sessionId)

    const sendingCreatedAt = now()

    // TODO: Expire or prune stale runtime contexts from disconnected services before composing.
    const userMessageContext: ChatStreamEventContext = {
      message: null,
      contexts: {},
      composedMessage: [],
      input: options.input,
    }
    deps.onLifecycle?.({
      phase: 'before-compose',
      channel: 'chat',
      sessionId,
      textPreview: userText,
      details: {
        contexts: userMessageContext.contexts,
      },
    })

    const isStaleGeneration = () =>
      deps.session.getSessionGeneration(sessionId) !== generation

    const shouldAbort = () => isStaleGeneration()
    if (shouldAbort())
      return

    setSending(true)

    const assistantMessage: StreamingAssistantMessage = {
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      createdAt: now(),
      id: createId(),
    }
    patchForegroundStream(assistantMessage)
    deps.onAssistantStreamingStarted?.()
    deps.onMessageSendStarted?.({
      source: options.input ? 'voice' : 'text',
      model: options.model,
    })
    const roundStartedAt = monotonicNow()

    try {
      await hooks.emitBeforeMessageComposeHooks(userText, userMessageContext)

      const contentParts: ContentPart[] = [{ type: 'text', text: userText }]
      if (!userMessageContext.input) {
        userMessageContext.input = {
          type: 'input:text',
          data: {
            text: userText,
          },
        }
      }

      if (shouldAbort())
        return

      const userMessage = {
        role: 'user' as const,
        content: contentParts,
        createdAt: sendingCreatedAt,
        id: createId(),
      }
      userMessageContext.message = userMessage

      deps.onUserMessageAppend?.({
        sessionId,
        message: userMessage,
        messageText: userText,
      })

      const sessionMessagesForSend = deps.session.getSessionMessages(sessionId)
      deps.onUserTurnReady?.({
        messageText: userText,
        sessionMessages: sessionMessagesForSend,
      })

      const categorizer = createStreamingCategorizer(deps.getActiveProvider())
      let streamPosition = 0

      const parser = useLlmmarkerParser({
        onLiteral: async (literal) => {
          if (shouldAbort())
            return

          categorizer.consume(literal)

          const speechOnly = categorizer.filterToSpeech(literal, streamPosition)
          streamPosition += literal.length

          if (speechOnly.trim()) {
            assistantMessage.content += speechOnly

            await hooks.emitTokenLiteralHooks(speechOnly, userMessageContext)

            const lastSlice = assistantMessage.slices.at(-1)
            if (lastSlice?.type === 'text') {
              lastSlice.text += speechOnly
            }
            else {
              assistantMessage.slices.push({
                type: 'text',
                text: speechOnly,
              })
            }
            patchForegroundStream(assistantMessage)
          }
        },
        onSpecial: async (special) => {
          if (shouldAbort())
            return

          await hooks.emitTokenSpecialHooks(special, userMessageContext)
        },
        onEnd: async (fullText) => {
          if (isStaleGeneration())
            return

          const finalCategorization = categorizeResponse(fullText, deps.getActiveProvider())

          const reasoningContentField = assistantMessage.categorization?.reasoning?.trim()
          assistantMessage.categorization = {
            speech: finalCategorization.speech,
            reasoning: reasoningContentField || finalCategorization.reasoning,
          }
          patchForegroundStream(assistantMessage)
        },
        minLiteralEmitLength: STREAMING_UI_FLUSH_CHUNK_SIZE,
      })

      const toolCallQueue = createQueue<MicroTurn>({
        handlers: [
          async (ctx) => {
            if (shouldAbort())
              return
            if (ctx.data.type === 'tool-call') {
              assistantMessage.slices.push(ctx.data)
              patchForegroundStream(assistantMessage)
              return
            }

            if (ctx.data.type === 'tool-call-result') {
              assistantMessage.tool_results.push(ctx.data)
              patchForegroundStream(assistantMessage)
            }
          },
        ],
      })

      const newMessages = sessionMessagesForSend

      userMessageContext.composedMessage = newMessages as Message[]
      deps.onLifecycle?.({
        phase: 'after-compose',
        channel: 'chat',
        sessionId,
        textPreview: userText,
        details: {
          composedMessage: newMessages,
        },
      })

      await hooks.emitAfterMessageComposedHooks(userText, userMessageContext)
      await hooks.emitBeforeSendHooks(userText, userMessageContext)

      let fullText = ''
      const headers = (options.providerConfig?.headers || {}) as Record<string, string>

      if (shouldAbort())
        return

      const llmRequestStartedAt = monotonicNow()
      let llmFirstTokenEmitted = false
      deps.onLlmRequestStarted?.({
        model: options.model,
        provider: deps.getActiveProvider() || 'unknown',
        hasVoice: !!options.input,
      })

      await deps.llm.stream(options.model, options.chatProvider, newMessages as Message[], {
        headers,
        tools: options.tools,
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
                deps.onLlmFirstToken?.({
                  model: options.model,
                  ttfbMs: Math.round(monotonicNow() - llmRequestStartedAt),
                })
              }
              fullText += event.text
              await parser.consume(event.text)
              break
            case 'reasoning-delta': {
              if (shouldAbort())
                return

              const { reasoning = '' } = assistantMessage.categorization ?? {}
              const nextReasoning = reasoning + event.text
              assistantMessage.categorization = {
                speech: typeof assistantMessage.content === 'string' ? assistantMessage.content : '',
                reasoning: nextReasoning,
              }
              const crossesBoundary
                = Math.floor(nextReasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
                  > Math.floor(reasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
              if (!reasoning || crossesBoundary)
                patchForegroundStream(assistantMessage)
              break
            }
            case 'finish':
              break
            case 'error':
              throw event.error ?? new Error('Stream error')
          }
        },
      })

      await parser.end()
      deps.onAssistantResponseRendered?.({
        model: options.model,
        latencyMs: Math.round(monotonicNow() - llmRequestStartedAt),
      })

      if (!isStaleGeneration() && assistantMessage.slices.length > 0) {
        const finalAssistant = assistantMessage
        deps.session.appendSessionMessage(sessionId, finalAssistant)
        deps.onAssistantMessageAppended?.({
          sessionId,
          message: finalAssistant,
          messageText: fullText,
        })
      }

      await hooks.emitStreamEndHooks(userMessageContext)
      await hooks.emitAssistantResponseEndHooks(fullText, userMessageContext)

      await hooks.emitAfterSendHooks(userText, userMessageContext)
      await hooks.emitAssistantMessageHooks({ ...assistantMessage }, fullText, userMessageContext)
      await hooks.emitChatTurnCompleteHooks({
        output: { ...assistantMessage },
        outputText: fullText,
        toolCalls: sessionMessagesForSend.filter(msg => msg.role === 'tool') as ToolMessage[],
      }, userMessageContext)

      deps.onAssistantTurnReady?.({
        messageText: fullText,
        sessionMessages: sessionMessagesForSend,
      })

      resetForegroundStream()
      deps.onMessageRound?.({
        durationMs: Math.round(monotonicNow() - roundStartedAt),
        hasVoice: !!options.input,
        model: options.model,
      })
    }
    catch (error) {
      console.error('Error sending message:', error)
      throw error
    }
    finally {
      setSending(false)
      deps.onSendSettled?.({ sessionId })
    }
  }

  function ingest(
    userText: string,
    options: ChatOrchestratorSendOptions,
    sessionId: string,
  ) {
    const generation = deps.session.getSessionGeneration(sessionId)
    return performSend(userText, options, generation, sessionId)
  }

  return {
    ingest,
    hooks,
  }
}
