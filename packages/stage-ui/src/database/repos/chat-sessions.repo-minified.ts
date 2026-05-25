import type { SessionRecord, UserSessionIndex } from '../../types/chat-session-minimized'

import { storage } from '../storage'

export const chatSessionsRepo = {
  async getIndex(userId: string) {
    const key = `local:chat/index/${userId}`
    return await storage.getItemRaw<UserSessionIndex>(key)
  },

  async saveIndex(index: UserSessionIndex) {
    const key = `local:chat/index/${index.userId}`
    await storage.setItemRaw(key, index)
  },

  async getSession(sessionId: string) {
    const key = `local:chat/sessions/${sessionId}`
    return await storage.getItemRaw<SessionRecord>(key)
  },

  async saveSession(sessionId: string, record: SessionRecord) {
    const key = `local:chat/sessions/${sessionId}`
    await storage.setItemRaw(key, record)
  },

  // Cleanup
  async deleteSession(sessionId: string) {
    await storage.removeItem(`local:chat/sessions/${sessionId}`)
  },
}
