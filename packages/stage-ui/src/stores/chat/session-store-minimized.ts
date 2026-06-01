import type { ChatHistoryItem } from '../../types/chat'
import type { SessionMeta, SessionRecord, UserSessionIndex } from '../../types/chat-session-minimized'

import { errorMessageFrom } from '@moeru/std'
import { cloneDeep } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo-minified'
import { ChatRoom, Participant } from '../chat_room'
import { useAiriCardStore } from '../modules/airi-card'

const session = ref<ChatRoom<ChatHistoryItem> | null>(null)
const sessionMetadata = ref<SessionMeta | null>(null)
const loadingSessions = new Map<string, Promise<SessionRecord | void>>()

let persistQueue = Promise.resolve()

function enqueuePersist<T>(task: () => Promise<T>): Promise<T> {
  const next = persistQueue.then(task)
  persistQueue = next.then(
    () => undefined,
    (err) => {
      console.warn('[chat-session] persist task failed:', errorMessageFrom(err))
    },
  )
  return next
}

async function loadSessionById(sessionId: string) {
  const loadingPromise = loadingSessions.get(sessionId)
  if (loadingPromise) {
    return await loadingPromise
  }

  const loadPromise
    = chatSessionsRepo.getSession(sessionId)
      .then(
        (record) => {
          if (!record)
            throw new Error('Session not found')
          return record
        },
      )
      .catch(e => console.warn('[chat-session] loadSession failed for', sessionId, errorMessageFrom(e)))
      .finally(() => loadingSessions.delete(sessionId))
  loadingSessions.set(sessionId, loadPromise)
  return await loadPromise
}

/**
 * Centralized
 *
 */
export function useChatSessionStore() {
  const { activeCard, activeCardId, systemPrompt } = storeToRefs(useAiriCardStore())

  const participants = ref<Record<string, Participant<ChatHistoryItem>>>({
  // TODO: garbage-collect offline participant
    user: new Participant(nanoid(), 'user'),
    assistant: new Participant(nanoid(), 'assistant'),
    system: new Participant(nanoid(), 'system'),
    error: new Participant(nanoid(), 'system'),
  })
  const userId = 'local'
  const activeSessionId = ref<string>('')

  watch([activeSessionId], async () => {
    const index = await getOrCreateIndex(userId, activeCardId.value)
    // sync active session
    if (!index.sessions.includes(index.activeSessionId)) {
      index.activeSessionId = index.sessions[0]
    }
    if (!activeSessionId.value || !index.sessions.includes(activeSessionId.value)) {
      activeSessionId.value = index.activeSessionId
    }
    await chatSessionsRepo.saveIndex(index)
    const sessionRecord = await getOrCreateSession(activeSessionId.value)
    session.value = new ChatRoom(sessionRecord.messages)
  }, { immediate: true })

  function generateInitialMessage() {
    return {
      role: 'system',
      content: systemPrompt.value,
      id: nanoid(),
      createdAt: Date.now(),
    } satisfies ChatHistoryItem
  }

  /** Create an index if the index for the user does not exits. Populate existing index when the index contains no session. */
  async function getOrCreateIndex(userId: string, characterId: string): Promise<UserSessionIndex> {
    const index = await chatSessionsRepo.getIndex(userId)
    if (index && index.sessions.length > 0)
      return index
    const newSession = createRawSession(userId, characterId)
    const newIndex = {
      userId,
      activeSessionId: newSession.meta.sessionId,
      sessions: [newSession.meta.sessionId],
    }
    // overwrite existing empty index.
    chatSessionsRepo.saveIndex(newIndex)
    chatSessionsRepo.saveSession(newSession.meta.sessionId, newSession)
    return newIndex
  }

  async function getOrCreateSession(sessionId?: string): Promise<SessionRecord> {
    const sessionRecord = await chatSessionsRepo.getSession(sessionId ?? activeSessionId.value)
    if (!sessionRecord)
      return createSession(activeCardId.value)
    if (sessionRecord.messages.length < 1)
      sessionRecord.messages.push(generateInitialMessage())
    return sessionRecord
  }

  async function saveSession() {
    if (!sessionMetadata.value || !session.value)
      return
    chatSessionsRepo.saveSession(activeSessionId.value, cloneDeep({ meta: sessionMetadata.value, messages: session.value.messages }))
  }

  async function createSession(characterId: string, options?: { setActive?: boolean, messages?: ChatHistoryItem[], title?: string }): Promise<SessionRecord> {
    if (!activeCard.value)
      throw new Error('cannot create session: character card not found') // TODO: stricter check
    const initialMessages = options?.messages?.length ? cloneDeep(options.messages) : [generateInitialMessage()]
    const record = createRawSession(userId, characterId, { messages: initialMessages, title: options?.title })

    await enqueuePersist(() => chatSessionsRepo.saveSession(record.meta.sessionId, record))

    if (options?.setActive)
      activeSessionId.value = record.meta.sessionId

    return record
  }

  async function deleteSession(sessionId: string) {
    // TODO: delete session from character
    await enqueuePersist(() => chatSessionsRepo.deleteSession(sessionId))

    // TODO: select an existing session or create a new one
  }

  function sendMessage(participant: string, message: Partial<ChatHistoryItem>) {
    if (!participants.value[participant])
      return false
    Object.defineProperty(message, 'role', participant)
    if (!('createdAt' in message))
      Object.defineProperty(message, 'createdAt', Date.now())
    if (!('id' in message))
      Object.defineProperty(message, 'id', nanoid())
    participants.value[participant].postMessageRaw(message as ChatHistoryItem)
    return true
  }

  function setMessage(message: ChatHistoryItem[], append: boolean = false) {
    const maybeSession = session.value
    if (!maybeSession)
      return false
    if (append) {
      maybeSession.messages = maybeSession.messages.concat(message)
      return true
    }
    maybeSession.messages = message
  }

  onScopeDispose(() => {
    saveSession()
    Object.keys(participants.value)
      .forEach(k => participants.value[k].leave())
  })

  return {
    activeSession: session,
    activeSessionId,
    createSession,
    loadSession: loadSessionById,
    sendMessage,
    setMessage,
    deleteSession,
    saveSession,
  }
}

function createRawSession(userId: string, characterId: string, options?: { messages?: ChatHistoryItem[], title?: string }): SessionRecord {
  const newId = nanoid()
  const now = Date.now()
  const metadata: SessionMeta = {
    sessionId: newId,
    userId,
    characterId,
    title: options?.title,
    createdAt: now,
    updatedAt: now,
  }

  const initialMessages = cloneDeep(options?.messages ?? [])

  return { meta: metadata, messages: initialMessages }
}
