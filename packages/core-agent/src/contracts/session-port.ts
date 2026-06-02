import type { ChatHistoryItem } from '../types/chat'

export interface SessionPort {
  getSessionMessages: () => ChatHistoryItem[]
  appendSessionMessage: (message: ChatHistoryItem) => void
}
