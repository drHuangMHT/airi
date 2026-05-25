// Message interface representing a chat message
import type { ChatOrchestratorSendOptions, StreamOptions } from '@proj-airi/core-agent'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import { streamFrom as coreStreamFrom, createChatOrchestratorRuntime, modelKey as getModelKey } from '@proj-airi/core-agent'
import { listModels } from '@xsai/model'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { ref, toRaw } from 'vue'

import { createMinecraftContext } from './chat/context-providers'
import { useChatContextStore } from './chat/context-store'
import { useChatSessionStore } from './chat/session-store'
import { useChatStreamStore } from './chat/stream-store'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useConsciousnessStore } from './modules'

export interface GenericMessage {
  id: string // unique message identifier
  participantId?: string
  role?: string
  content?: unknown
  createdAt: number
}

export interface JoinInfo<M> {
  participantId: string
  role: string
  onNewMessage: (message: M) => void
}

export interface ChatroomJoined<M> {
  postMessage: (message: string) => void
  addMessage: (message: M) => void
  getHistory: () => M[]
  leave: () => void
}

export interface ParticipantRecord<M> {
  onNewMessage: (message: M) => void
}

type JoinTicket<M> = (joinInfo: JoinInfo<M>) => ChatroomJoined<M>

// ChatRoom class handles participants and message storage
export class ChatRoom<M extends GenericMessage> {
  messages: M[] = []
  participants: Map<string, ParticipantRecord<M>> = new Map()

  constructor(messages: M[] = []) {
    this.messages = messages
  }

  /**
   * Get a ticket to join the room.
   * The ticket may only be used once regardless of whether the join succeeded.
   * @returns A JoinTicket that allows one participant to join
   */
  joinTicket(): JoinTicket<M> {
    let spent = false
    return (joinInfo: JoinInfo<M>) => {
      if (spent)
        throw new Error('The JoinTicket is spent.')
      spent = true
      return this.addParticipant(joinInfo)
    }
  }

  /**
   * Add a participant into the chatroom.
   * @param joinInfo - Object containing participant ID and new message callback.
   * @returns A handle providing access to chat history.
   * @throws Error if participant already joined.
   */
  addParticipant(joinInfo: JoinInfo<M>): ChatroomJoined<M> {
    const { participantId, onNewMessage } = joinInfo
    if (this.participants.has(participantId)) {
      throw new Error(`Participant ${participantId} has already joined the chatroom.`)
    }
    this.participants.set(participantId, { onNewMessage })
    // Return a handle that allows the participant to retrieve all messages (including future ones)
    return {
      postMessage: (content: string) => {
        this.checkParticipantPresence(joinInfo.participantId)
        const message: GenericMessage = {
          id: this.generateMessageId(),
          participantId,
          content,
          createdAt: new Date().getMilliseconds(),
        }
        this.postMessage(joinInfo.participantId, message as M) // TODO: replace to actual impl
      },
      addMessage: (message: M) => { this.messages.push(message); this.participants.forEach(participant => participant.onNewMessage(message)) },
      getHistory: () => {
        this.checkParticipantPresence(joinInfo.participantId)
        return [...this.messages]// return a copy to prevent direct mutation
      },
      leave: () => this.removeParticipant(joinInfo.participantId),
    }
  }

  /**
   * Remove a participant from the chatroom.
   * @param participantId - ID of the participant leaving.
   * @throws Error if participant is not in the room.
   */
  removeParticipant(participantId: string): void {
    this.participants.delete(participantId)
  }

  /**
   * Post a message to the chatroom.
   * @param participantId - ID of the sender.
   * @param message - The message to add.
   * @throws Error if participant has not joined.
   */
  private postMessage(participantId: string, message: M): void {
    if (!this.participants.has(participantId)) {
      throw new Error(`Participant ${participantId} has not joined the chatroom.`)
    }
    this.messages.push(message)
    // Notify all participants (including sender) about the new message
    this.participants.forEach(participant => participant.onNewMessage(message))
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private checkParticipantPresence(id: string) {
    if (!this.participants.has(id)) {
      throw new Error(`Participant ${id} is not in the chatroom.`)
    }
  }
}

// Participant class representing a chatroom user
export class Participant<M extends GenericMessage> {
  private currentRoom: ChatroomJoined<M> | null = null
  private onMessageReceiveCallbacks: Array<(msg: M, self: Participant<M>) => void> = []

  constructor(
    private readonly id: string,
    private readonly role: string,
  ) {}

  /**
   * Join a chatroom.
   * @param joinTicket - A JoinTicket issued by a ChatRoom instance.
   */
  join(joinTicket: JoinTicket<M>): void {
    // Join the room using the participant's joinInfo
    this.currentRoom = joinTicket(this.joinInfo())
  }

  /**
   * Provides the information needed for the ChatRoom to register this participant.
   * @returns An object containing the participant's ID and a callback for new messages.
   */
  joinInfo(): JoinInfo<M> {
    return {
      role: this.role,
      participantId: this.id,
      onNewMessage: this.onNewMessage.bind(this),
    }
  }

  /**
   * Leave the current chatroom.
   * @throws Error if participant is not in any room.
   */
  leave(): void {
    if (this.currentRoom === null) {
      throw new Error(`Participant ${this.id} is not in any chatroom.`)
    }
    this.currentRoom.leave()
    this.currentRoom = null
  }

  /**
   * Send a message to the current chatroom.
   * @param content - Message content.
   * @throws Error if participant has not joined a room.
   */
  postMessage(content: string): void {
    if (this.currentRoom === null) {
      throw new Error(`Participant ${this.id} has not joined any chatroom.`)
    }
    this.currentRoom.postMessage(content)
  }

  postMessageRaw(message: M): void {
    if (this.currentRoom === null) {
      throw new Error(`Participant ${this.id} has not joined any chatroom.`)
    }
    this.currentRoom.addMessage(message)
  }

  /**
   * Retrieve the chat history from the joined room.
   * @returns Array of all messages in the chatroom.
   * @throws Error if participant has not joined a room.
   */
  getHistory(): M[] {
    if (this.currentRoom === null) {
      throw new Error(`Participant ${this.id} has not joined any chatroom.`)
    }
    return this.currentRoom.getHistory()
  }

  registerMessageCallback(cb: (msg: M) => void) {
    this.onMessageReceiveCallbacks.push(cb)
  }

  /**
   * Callback invoked by the ChatRoom when a new message arrives.
   * @param message - The new message.
   */
  private onNewMessage(message: M): void {
    this.onMessageReceiveCallbacks.forEach(cb => cb(message, this))
    // In a real application, this could update UI, log to console, or store locally.
    // For demonstration, we simply log.
    console.info(`[${new Date(message.createdAt).toISOString()}] ${message.participantId}: ${message.content}`)
  }
}

const room = new ChatRoom()
const user = new Participant('user', 'user')
const assistant = new Participant('assistant', 'assistant')

assistant.join(room.joinTicket())
user.join(room.joinTicket())

export function useChatroomOrchestrator() {
  const llm = useStreamingLLMResponse()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider } = storeToRefs(consciousnessStore)

  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const contextObservability = useContextObservabilityStore()
  const { activeSessionId } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = ref(false)
  const pendingQueuedSendCount = ref(0)

  const runtime = createChatOrchestratorRuntime({
    session: {
      ensureSession: sessionId => chatSession.ensureSession(sessionId),
      getSessionMessages: sessionId => chatSession.getSessionMessages(sessionId).map(message => toRaw(message)),
      appendSessionMessage: (sessionId, message) => chatSession.appendSessionMessage(sessionId, message),
      getSessionGeneration: sessionId => chatSession.getSessionGeneration(sessionId),
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
      stream: llm.stream,
    },
    getActiveSessionId: () => activeSessionId.value,
    getActiveProvider: () => activeProvider.value,
    runtimeContextProviders: [
      createMinecraftContext,
    ],
    createId: nanoid,
    unwrapMessage: message => toRaw(message),
    onStateChange: (state) => {
      sending.value = state.sending
      pendingQueuedSendCount.value = state.pendingQueuedSendCount
    },
    onLifecycle: record => contextObservability.recordLifecycle(record),
    onPromptProjection: payload => contextObservability.capturePromptProjection(payload),
  })

  runtime.hooks.onChatTurnComplete(async (chat) => {
    assistant.postMessage(chat.output.content as string)
  })

  function ingest(message: string, options: ChatOrchestratorSendOptions, targetSessionId?: string) {
    runtime.ingest(message, options, targetSessionId)
    user.postMessage(message)
  }

  return {
    sending: false,
    pendingQueuedSendCount: 0,

    ingest,
    cancelPendingSends: () => console.error('unimplemented: cancelPendingSends'),
    getPendingQueuedSendSnapshot: () => [],
  }
}

export function useStreamingLLMResponse() {
  async function stream(model: string, chatProvider: ChatProvider, messages: Message[], options?: StreamOptions) {
    const modelKey = getModelKey(model, chatProvider)

    const runStream = () => coreStreamFrom({
      model,
      chatProvider,
      messages,
      options: {
        ...options,
      },
      builtinToolsResolver: async () => [],
    })

    try {
      console.info(`using model ${modelKey}`)
      await runStream()
    }
    catch (err) {
      console.warn(err)
    }
  }
  async function models(apiUrl: string, apiKey: string) {
    if (apiUrl === '')
      return []

    try {
      return await listModels({
        baseURL: (apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`) as `${string}/`,
        apiKey,
      })
    }
    catch (err) {
      if (String(err).includes(`Failed to construct 'URL': Invalid URL`))
        return []
      throw err
    }
  }
  return {
    models,
    stream,
  }
}
