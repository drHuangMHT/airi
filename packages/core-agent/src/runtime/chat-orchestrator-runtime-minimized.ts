import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { CommonContentPart as ContentPart, Message, ToolMessage } from '@xsai/shared-chat'

import type { SessionPort } from '../contracts/session-port'
import type { ChatHistoryItem, ChatStreamEventContext, ContextMessage, MicroTurn, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from '../types/llm'

import { createQueue } from '@proj-airi/stream-kit'

import { createChatHooks } from './agent-hooks'
import { useLlmmarkerParser } from './llm-marker-parser'
import { categorizeResponse, createStreamingCategorizer } from './response-categoriser'

const STREAMING_UI_FLUSH_CHUNK_SIZE = 24

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
 * LLM streaming boundary used by the core chat orchestrator runtime.
 */
export interface LLMPort {
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
  session: SessionPort
  /** Provider-agnostic LLM streaming port. */
  llm: LLMPort
  /** Clock used for persisted message timestamps. @default Date.now */
  now?: () => number
  /** Monotonic clock used for elapsed telemetry in milliseconds. @default performance.now */
  monotonicNow?: () => number
  /** ID factory used for persisted chat messages. @default crypto.randomUUID fallback */
  createId?: () => string
  /** Called for context/prompt lifecycle observability. */
  onLifecycle?: (record: ChatOrchestratorLifecycleRecord) => void
  /** Called with the final provider prompt projection. */
  onPromptProjection?: (payload: ChatOrchestratorPromptProjection) => void
  turnLifecycle?: ChatTurnLifecycleHooks
}

interface ChatTurnLifecycleHooks {
  /**
   * Called right before the context freeze.
   * This is the last chance of injecting context info.
   */
  onBeforeContextFreeze?: (event: {
    context: ChatStreamEventContext
  }) => void
  /**
   * Called right after the context freeze.
   * The session SHOULD NOT accept further messages after this point.
   */
  onAfterContextFreeze?: (event: {
    message: Extract<ChatHistoryItem, { role: 'user' }> & { id: string }
    messageText: string
  }) => void
  onGenerationStarted?: () => void
  /**
   * Called after the assistant message has been fully parsed.
   * This is the only chance to make changes to the generate assistant message
   */
  onAssistantMessageParsed?: () => void
  /** Called after the assistant message has been appended into session history. */
  onAssistantMessageAppended?: (event: {
    message: StreamingAssistantMessage
    messageText: string
  }) => void
  /**
   * Called after assistant streaming and hook finalization.
   * The session should be able to accept further user input.
   */
  onTurnReady?: () => void
}

/**
 * Platform-agnostic chat orchestrator runtime API.
 */
export interface ChatOrchestratorRuntime {
  /** Enqueues a user send for the target session, preserving FIFO order. */
  ingest: (sendingMessage: string, options: ChatOrchestratorSendOptions) => Promise<void>
  hooks: ReturnType<typeof createChatHooks>
}

function defaultCreateId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Creates the core chat orchestrator runtime used behind UI facades.
 * Does not handle session switch during assistant message composition.
 */
export function createChatOrchestratorRuntimeMinimized(deps: ChatOrchestratorRuntimeDeps): ChatOrchestratorRuntime {
  const hooks = createChatHooks()
  const now = deps.now ?? (() => Date.now())
  const analyticNow = deps.monotonicNow ?? (() => globalThis.performance?.now?.() ?? Date.now())
  const createId = deps.createId ?? defaultCreateId

  async function performSend(
    userText: string,
  ) {
    if (!userText)
      return
    const sendingCreatedAt = now()

    // TODO: Expire or prune stale runtime contexts from disconnected services before composing.
    const userMessageContext: ChatStreamEventContext = {
      message: null,
      contexts: {},
      composedMessage: [],
    }

    const contentParts: ContentPart[] = [{ type: 'text', text: userText }]

    deps.turnLifecycle?.onBeforeContextFreeze?.({
      context: userMessageContext,
    })

    // TODO: handle attachments
    const userMessage = {
      role: 'user' as const,
      content: contentParts,
      createdAt: sendingCreatedAt,
      id: createId(),
    }
    userMessageContext.message = userMessage

    const shouldAbort = () => false
    if (shouldAbort())
      return

    const assistantMessage: StreamingAssistantMessage = {
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      createdAt: now(),
      id: createId(),
    }
    const roundStartedAt = analyticNow()

    try {
      await hooks.emitBeforeMessageComposeHooks(userText, userMessageContext)

      deps.turnLifecycle?.onAfterContextFreeze?.({
        message: userMessage,
        messageText: userText,
      })

      const sessionMessagesForSend = deps.session.getSessionMessages()

      const categorizer = createStreamingCategorizer()
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
          }
        },
        onSpecial: async (special) => {
          if (shouldAbort())
            return

          await hooks.emitTokenSpecialHooks(special, userMessageContext)
        },
        onEnd: async (fullText) => {
          if (shouldAbort())
            return

          const finalCategorization = categorizeResponse(fullText)

          const reasoningContentField = assistantMessage.categorization?.reasoning?.trim()
          assistantMessage.categorization = {
            speech: finalCategorization.speech,
            reasoning: reasoningContentField || finalCategorization.reasoning,
          }
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
              return
            }

            if (ctx.data.type === 'tool-call-result') {
              assistantMessage.tool_results.push(ctx.data)
            }
          },
        ],
      })

      const newMessages = sessionMessagesForSend

      userMessageContext.composedMessage = newMessages as Message[]
      deps.onLifecycle?.({
        phase: 'after-compose',
        channel: 'chat',
        details: {
          textPreview: userText,
          composedMessage: newMessages,
        },
      })

      let fullText = ''
      const headers = {} as Record<string, string>

      if (shouldAbort())
        return

      const llmRequestStartedAt = analyticNow()
      let llmFirstTokenEmitted = false

      await deps.llm.stream(newMessages as Message[], {
        headers,
        tools: options.tools,
        waitForTools: true,
        captureToolErrors: true,
        onStreamEvent: async (event: StreamEvent) => {
          handleStreamEvent(event, {
            toolCallEnqueue: toolCallQueue.enqueue,
            onTextDelta: () => {
              if (llmFirstTokenEmitted)
                return
              llmFirstTokenEmitted = true
              deps.onLifecycle?.({
                phase: 'after-compose',
                channel: 'chat',
                details: {
                  model: options.model,
                  ttfbMs: Math.round(analyticNow() - llmRequestStartedAt),
                },
              })
            },
            analyticNow,
            appendFullText: text => fullText += text,
            assistantMessage,
            options,
            shouldAbort,
            writeGenerationStream: () => {},
            parser,
          })
        },
      })

      await parser.end()

      if (!shouldAbort() && assistantMessage.slices.length > 0) {
        const finalAssistant = assistantMessage
        deps.session.appendSessionMessage(finalAssistant)
        deps.turnLifecycle?.onAssistantMessageAppended?.({
          message: finalAssistant,
          messageText: fullText,
        })
      }

      await hooks.emitStreamEndHooks(userMessageContext)

      await hooks.emitChatTurnCompleteHooks({
        output: { ...assistantMessage },
        outputText: fullText,
        toolCalls: sessionMessagesForSend.filter(msg => msg.role === 'tool') as ToolMessage[],
      }, userMessageContext)

      deps.onLifecycle?.({
        phase: 'after-compose',
        channel: 'chat',
        details: {
          durationMs: Math.round(analyticNow() - roundStartedAt),
          hasVoice: !!options.input,
          model: options.model,
        },
      })
    }
    catch (error) {
      console.error('Error sending message:', error)
      throw error
    }
    finally {
      deps.turnLifecycle?.onTurnReady?.()
    }
  }

  function ingest(
    userText: string,
  ) {
    return performSend(userText)
  }

  return {
    ingest,
    hooks,
  }
}

async function handleStreamEvent(
  ev: StreamEvent,
  ctx: {
    toolCallEnqueue: (turn: MicroTurn) => void
    assistantMessage: StreamingAssistantMessage
    appendFullText: (text: string) => void
    onTextDelta: () => void
    options: Pick<ChatOrchestratorSendOptions, 'model'>
    analyticNow: () => number
    shouldAbort: () => boolean
    writeGenerationStream: (message: StreamingAssistantMessage) => void
    parser: ReturnType<typeof useLlmmarkerParser>
  },
) {
  switch (ev.type) {
    case 'tool-call':
      ctx.toolCallEnqueue({
        type: 'tool-call',
        toolCall: ev,
      })
      break
    case 'tool-result':
      ctx.toolCallEnqueue({
        type: 'tool-call-result',
        id: ev.toolCallId,
        result: ev.result,
      })

      break
    case 'tool-error':
      ctx.toolCallEnqueue({
        type: 'tool-call-result',
        id: ev.toolCallId,
        isError: true,
        result: ev.result,
      })

      break
    case 'text-delta':
      ctx.onTextDelta()
      ctx.appendFullText(ev.text)
      await ctx.parser.consume(ev.text)
      break
    case 'reasoning-delta': {
      if (ctx.shouldAbort())
        return

      const { reasoning = '' } = ctx.assistantMessage.categorization ?? {}
      const nextReasoning = reasoning + ev.text
      ctx.assistantMessage.categorization = {
        speech: typeof ctx.assistantMessage.content === 'string' ? ctx.assistantMessage.content : '',
        reasoning: nextReasoning,
      }
      const crossesBoundary
        = Math.floor(nextReasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
          > Math.floor(reasoning.length / STREAMING_UI_FLUSH_CHUNK_SIZE)
      if (!reasoning || crossesBoundary)
        ctx.writeGenerationStream(ctx.assistantMessage)
      break
    }
    case 'finish':
      break
    case 'error':
      throw ev.error ?? new Error('Stream error')
  }
}
