<script setup lang="ts">
import type { SessionRecord, UserSessionIndex } from '@proj-airi/stage-ui/types/chat-session-minimized'

import { deleteIndexedDBKey, getKeysWithPrefix, getValues } from '@proj-airi/stage-shared/composables'
import { ChatHistory, ExpandableListItem } from '@proj-airi/stage-ui/components'
import { chatSessionsRepo } from '@proj-airi/stage-ui/database/repos/chat-sessions.repo-minified'
import { migrateSession } from '@proj-airi/stage-ui/types/chat-session-migrate'
import { ref, watch } from 'vue'

const loadedIndex = ref<UserSessionIndex | null>(null)
const loadedSessions = ref<Map<string, SessionRecord>>(new Map())
const currentUser = ref('local')
const needMigrate = ref(false)
const allSessions = ref<Set<string>>(new Set())

async function loadSessions(orphanedOnly: boolean = false) {
  try {
    const allSessionKeys = await getKeysWithPrefix('keyval-store', 'keyval', 'airi-local:chat:sessions')
    const nonOrphanedSessionKey = new Set()
    const indexes = (await getValues('keyval-store', 'keyval', await getKeysWithPrefix('keyval-store', 'keyval', 'airi-local:chat:index'))
    ).filter((index: unknown) => index != null && typeof index === 'object' && !('characters' in index) && ('activeSessionId' in index)) as UserSessionIndex[]
    indexes.map(i => i.sessions).flat().forEach(s => nonOrphanedSessionKey.add(`airi-local:chat:sessions:${s}`))
    if (!orphanedOnly)
      return allSessions.value = new Set(allSessionKeys.map(k => k.toString().replace('airi-local:chat:sessions:', '')))
    const allSessionKeysSet = new Set(allSessionKeys)
    allSessions.value = new Set(allSessionKeysSet.difference(nonOrphanedSessionKey).keys().map(k => k.toString().replace('airi-local:chat:sessions:', '')))
  }
  catch (e) { console.warn(e) }
}

watch(currentUser, async () => {
  const index = await chatSessionsRepo.getIndex(currentUser.value)
  if (index != null && typeof index === 'object' && 'characters' in index) {
    needMigrate.value = true
  }
  loadedIndex.value = index
  index?.sessions.forEach((id) => {
    chatSessionsRepo.getSession(id).then((session) => {
      if (session)
        loadedSessions.value.set(id, session)
    }).catch(() => {})
  })
}, { immediate: true })
</script>

<template>
  <main p-4>
    <section v-if="needMigrate">
      <p>We detected an outdated session record, press to migrate</p>
      <button @click="() => migrateSession(currentUser)">
        Migrate
      </button>
    </section>
    <section>
      <h2>Sessions for current user</h2>
      <ul v-if="loadedIndex !== null" p-2>
        <li v-for="sessionId in loadedIndex.sessions" :key="sessionId" border p-1>
          <ExpandableListItem :label="sessionId">
            <template #expanded>
              <ChatHistory
                :messages="loadedSessions.get(sessionId)?.messages ?? []"
                h-full
                variant="desktop"
              />
            </template>
          </ExpandableListItem>
        </li>
      </ul>
    </section>
    <section>
      <h2>
        All sessions stored on the instance <button @click="() => loadSessions(true)">
          Load
        </button>
      </h2>
      <ul v-if="allSessions.size !== 0" p-2>
        <li v-for="sessionId in allSessions" :key="sessionId" border p-1>
          {{ sessionId }}
          <button
            @click="() => {
              deleteIndexedDBKey('keyval-store', 'keyval', `airi-local:chat:sessions:${sessionId}`)
                .then(_ => allSessions.delete(sessionId))
            }"
          >
            Delete
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
