import type { ChatHistoryItem } from '../../types/chat'
import type { SessionMeta, SessionRecord, UserSessionIndex } from '../../types/chat-session-minimized'

import { cloneDeep } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo-minified'
import { ChatRoom, Participant } from '../chat_room'
import { useAiriCardStore } from '../modules/airi-card'

/**
 * manages one session selection.
 * TODO: sync between all that opened the same chat session.
 */
export function useChatSession() {
  const { activeCard, activeCardId, systemPrompt } = storeToRefs(useAiriCardStore())

  const session = ref<ChatRoom<ChatHistoryItem> | null>(null)
  const sessionMetadata = ref<SessionMeta | null>(null)

  const participants = ref<Record<string, Participant<ChatHistoryItem>>>({
  // TODO: garbage-collect offline participants
    user: new Participant(nanoid(), 'user'),
    assistant: new Participant(nanoid(), 'assistant'),
    system: new Participant(nanoid(), 'system'),
    error: new Participant(nanoid(), 'system'),
  })
  const userId = 'local' // TODO: handle user switching
  const sessionId = ref<string>('')

  watch([sessionId], async () => {
    const index = await getOrCreateIndex(userId, activeCardId.value)
    // sync active session
    if (!index.sessions.includes(index.activeSessionId)) {
      index.activeSessionId = index.sessions[0] // fix invalid session in index
    }
    if (!sessionId.value || !index.sessions.includes(sessionId.value)) {
      sessionId.value = index.activeSessionId // sync/fix invalid chat session in this session
    }
    await chatSessionsRepo.saveIndex(index)
    const sessionRecord = await getOrCreateSession()
    session.value = new ChatRoom(sessionRecord.messages)
  }, { immediate: true })

  watch([() => session.value?.messages], async () => {
    await saveSession()
  })

  function generateInitialMessage() {
    return {
      role: 'system',
      content: systemPrompt.value,
      id: nanoid(),
      createdAt: Date.now(),
    } satisfies ChatHistoryItem
  }

  async function getOrCreateSession(): Promise<SessionRecord> {
    const sessionRecord = await chatSessionsRepo.getSession(sessionId.value)
    if (!sessionRecord)
      return createSession()
    if (sessionRecord.messages.length < 1) {
      sessionRecord.messages.push(generateInitialMessage()) // saved automatically by watcher
    }
    return sessionRecord
  }

  async function saveSession() {
    if (!sessionMetadata.value || !session.value)
      return
    await chatSessionsRepo.saveSession(sessionId.value, cloneDeep({ meta: sessionMetadata.value, messages: session.value.messages }))
  }

  /** Create a new session with the currently selected character, update and save index, save the new session. */
  async function createSession(options?: { setActive?: boolean, messages?: ChatHistoryItem[], title?: string }): Promise<SessionRecord> {
    if (!activeCard.value)
      throw new Error('cannot create session: character card not found') // TODO: stricter check
    const initialMessages = options?.messages?.length ? cloneDeep(options.messages) : [generateInitialMessage()]
    const record = createRawSession(userId, activeCardId.value, { messages: initialMessages, title: options?.title })
    await chatSessionsRepo.saveSession(record.meta.sessionId, record)
    // update index
    const index = await getOrCreateIndex(userId, activeCardId.value)
    if (options?.setActive) {
      sessionId.value = record.meta.sessionId
      index.activeSessionId = record.meta.sessionId
    }
    index.sessions.push(record.meta.sessionId)
    await chatSessionsRepo.saveIndex(index)
    return record
  }

  async function deleteOpenedSession(createNew: boolean = true) {
    // TODO: delete session from character
    // update index
    const index = await getOrCreateIndex(userId, activeCardId.value)
    index.sessions = index.sessions.filter(i => i !== sessionId.value)
    if (createNew)
      await createSession({ setActive: true })
    else
      index.activeSessionId = index.sessions[0]
    sessionId.value = index.activeSessionId
    await chatSessionsRepo.saveIndex(index)
    await chatSessionsRepo.deleteSession(sessionId.value)
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
    return true
  }

  onScopeDispose(() => {
    saveSession()
    Object.keys(participants.value)
      .forEach(k => participants.value[k].leave())
  })

  return {
    session,
    sessionId,
    createSession,
    sendMessage,
    setMessage,
    deleteOpenedSession,
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
