import type { ChatHistoryItem } from '../../types/chat'
import type { SessionMeta, SessionRecord, UserSessionIndex } from '../../types/chat-session-minimized'
import type { ChatRoom } from '../chat_room'

import { cloneDeep } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { ref } from 'vue'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo-minified'

const loadedSessions = ref<Map<string, [SessionMeta, ChatRoom<ChatHistoryItem>]>>(new Map())
const loadedIndex = ref<UserSessionIndex | null>(null)
const userId = 'local'

/** This MUST be called on the main process. */
async function init(userId: string) {
  if (!loadedIndex.value) {
    const index = await chatSessionsRepo.getIndex(userId)
    if (!index)
      await createSessionIndex(userId)
    loadedIndex.value = index
  }
}

async function createSessionIndex(userId: string) {
  const index = await chatSessionsRepo.getIndex(userId)
  if (index)
    return
  const newSession = createRawSession()
  const newIndex = {
    userId,
    activeSessionId: newSession.meta.sessionId,
    sessions: [newSession.meta.sessionId],
  }
  await chatSessionsRepo.saveIndex(newIndex)
}

/**
 * Centralized management of multiple sessions.
 * This MUST be called on the main process.
 */
export function useSessionManager() {
  return {
    onStoreInit: init,
    loadedSessions,
  }
}

function createRawSession(characterId?: string, options?: { messages?: ChatHistoryItem[], title?: string }): SessionRecord {
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
