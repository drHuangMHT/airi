import type { ChatHistoryItem } from '../../types/chat'
import type { SessionMeta, SessionRecord, UserSessionIndex } from '../../types/chat-session-minimized'

import { errorMessageFrom } from '@moeru/std'
import { cloneDeep } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo-minified'
import { ChatRoom } from '../chat_room'
import { useAiriCardStore } from '../modules/airi-card'

const userId = 'local'
const activeSessionId = ref<string>('')
const loadedSessions = ref<Map<string, [SessionMeta, ChatRoom<ChatHistoryItem>]>>(new Map())
const loadedIndex = ref<UserSessionIndex | null>(null)
const activeSession = computed(() => loadedSessions.value.get(activeSessionId.value))
const sessionMessages = computed(() => activeSession.value?.[1].messages)
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

async function onStoreInit(userId: string) {
  if (!loadedIndex.value) {
    const index = await chatSessionsRepo.getIndex(userId)
    if (!index)
      throw new Error(`User ${userId} does not have a session index`)
    loadedIndex.value = index
  }
  if (loadedSessions.value.size === 0) {
    for (let i = 0; i < Math.min(loadedIndex.value.sessions.length, 3); i++) {
      const idToLoad = loadedIndex.value.sessions[i]
      await loadSessionById(idToLoad).catch(e => console.warn(`Failed to load session ${idToLoad}:`, e))
    }
  }
  if (!activeSession.value) {
    const oldActiveSession = loadedIndex.value.activeSessionId
    if (!loadedIndex.value.sessions.includes(oldActiveSession))
      loadedIndex.value.activeSessionId = loadedIndex.value.sessions[0] // TODO: handle undefined
    activeSessionId.value = loadedIndex.value.activeSessionId
  }
}

async function createSessionIndex(userId: string, characterId: string) {
  const index = await chatSessionsRepo.getIndex(userId)
  if (index)
    return
  const newSession = createRawSession(characterId)
  const newIndex = {
    userId,
    activeSessionId: newSession.meta.sessionId,
    sessions: [newSession.meta.sessionId],
  }
  await chatSessionsRepo.saveIndex(newIndex)
}

async function loadSessionById(sessionId: string) {
  if (loadedSessions.value.has(sessionId)) {
    return
  }

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
          loadedSessions.value.set(sessionId, [record.meta, new ChatRoom(record.messages)])
          return record
        },
      )
      .catch(e => console.warn('[chat-session] loadSession failed for', sessionId, errorMessageFrom(e)))
      .finally(() => loadingSessions.delete(sessionId))
  loadingSessions.set(sessionId, loadPromise)
  return await loadPromise
}

export function useChatSessionStore() {
  const { activeCard, activeCardId, systemPrompt } = storeToRefs(useAiriCardStore())

  try {
    onStoreInit(userId)
  }
  catch (e) {
    if (e instanceof Error && e.message.includes('does not have a session index')) {
      createSession(activeCardId.value)
    }
  }

  function generateInitialMessage() {
    return {
      role: 'system',
      content: systemPrompt.value,
      id: nanoid(),
      createdAt: Date.now(),
    } satisfies ChatHistoryItem
  }

  /** return true when session exists */
  async function loadOrCreateSession(characterId: string) {
    if (loadedIndex.value !== null)
      return true
    const index = await chatSessionsRepo.getIndex(userId)
    if (!index) { // create index if not exist
      createSessionIndex(userId, characterId)
      loadedIndex.value = await chatSessionsRepo.getIndex(userId)
      return false
    }
    loadedIndex.value = index
    return true
  }

  async function saveAllSessions() {
    for (const [sessionId, [meta, session]] of loadedSessions.value.entries()) {
      chatSessionsRepo.saveSession(sessionId, cloneDeep({ meta, messages: session.messages }))
    }
  }

  async function createSession(characterId: string, options?: { setActive?: boolean, messages?: ChatHistoryItem[], title?: string }) {
    if (!loadOrCreateSession(characterId))
      return

    if (!activeCard.value)
      return console.warn('cannot create session: character card not found') // TODO: stricter check

    const initialMessages = options?.messages?.length ? cloneDeep(options.messages) : [generateInitialMessage()]
    const record = createRawSession(characterId, { messages: initialMessages, title: options?.title })

    await enqueuePersist(() => chatSessionsRepo.saveSession(record.meta.sessionId, record))

    if (options?.setActive)
      activeSessionId.value = record.meta.sessionId

    return record.meta.sessionId
  }

  async function deleteSession(sessionId: string) {
    loadedSessions.value.delete(sessionId)

    // TODO: delete session from character

    await enqueuePersist(() => chatSessionsRepo.deleteSession(sessionId))
    // TODO: select an existing session or create a new one
  }

  async function deleteAllSessions() {
    for (const sessionId of loadedSessions.value.keys())
      await deleteSession(sessionId)
  }

  onScopeDispose(() => {
    saveAllSessions()
  })

  return {
    activeSession,
    activeSessionId,
    sessionMessages,

    resetAllSessions: deleteAllSessions,

    createSession,
    loadSession: loadSessionById,
    deleteSession,
    saveAllSessions,
  }
}

function createRawSession(characterId: string, options?: { messages?: ChatHistoryItem[], title?: string }): SessionRecord {
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
