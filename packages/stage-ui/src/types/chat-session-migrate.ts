import type { ChatCharacterSessionsIndex } from './chat-session'
import type { UserSessionIndex } from './chat-session-minimized'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo-minified'

export async function migrateSession(userId: string) {
  const index: unknown = await chatSessionsRepo.getIndex(userId)
  console.info(JSON.stringify(index))
  if (!index)
    return
  if (typeof index === 'object' && 'characters' in index) {
    console.info(JSON.stringify(index))
    const characters = index.characters as Record<string, ChatCharacterSessionsIndex>
    const sessions = []
    for (const character of Object.keys(characters)) {
      for (const key of Object.keys(characters[character].sessions)) {
        sessions.push(characters[character].sessions[key].sessionId)
      }
    }

    const newIndex: UserSessionIndex = {
      userId,
      activeSessionId: (index.characters as any).default.activeSessionId,
      sessions,
    }
    await chatSessionsRepo.saveIndex(newIndex)
  }
}

const _testVector = {
  userId: 'local',
  characters: {
    default: {
      activeSessionId: 'tFLfZMByP3D-XdzLJPrrS',
      sessions: {
        'tFLfZMByP3D-XdzLJPrrS': {
          sessionId: 'tFLfZMByP3D-XdzLJPrrS',
          userId: 'local',
          characterId: 'default',
          createdAt: 1779178339967,
          updatedAt: 1779512742200,
        },
      },
    },
  },
}
