/**
 * MVP draft of the character store — local-first, optimistic CRUD + like/bookmark.
 *
 * Single-file, self-contained version that replaces the real model (unstorage)
 * and service (Hono client) with in-memory equivalents so the store can be used
 * immediately for prototyping, tests, or UI development.
 *
 * Architecture mirrors the production store:
 *   in-memory model  →  controller  →  Pinia defineStore
 *   mock service
 *
 * Use when:
 * - Prototyping character CRUD UI without a backend
 * - Writing unit tests that need a realistic store shape
 * - Understanding the local-first optimistic-update pattern in isolation
 *
 * Expects:
 * - Vue 3 + Pinia runtime (already in the project)
 *
 * Returns:
 * - A Pinia store with the same public API surface as useCharacterStore
 */

import type {
  parse as parseValibot,
} from 'valibot'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import {
  array,
  date,
  object,
  pipe,
  string,
  transform,
  union,
} from 'valibot'
import { computed, ref } from 'vue'

// ---------------------------------------------------------------------------
// Types (simplified — no relations, no capabilities / avatarModels / prompts)
// ---------------------------------------------------------------------------

const DateSchema = pipe(
  union([string(), date()]),
  transform(v => new Date(v)),
)

const CharacterSchema = object({
  id: string(),
  version: string(),
  coverUrl: string(),
  characterId: string(),
  /** Display name (flattened from i18n for MVP simplicity). */
  name: string(),
  /** Description text (flattened from i18n). */
  description: string(),
  creatorId: string(),
  ownerId: string(),
  likesCount: number(),
  bookmarksCount: number(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  likes: array(object({ userId: string(), characterId: string() })),
  bookmarks: array(object({ userId: string(), characterId: string() })),
})

/** Runtime character shape after Valibot parsing (dates are Date objects). */
type Character = ReturnType<typeof parseValibot<typeof CharacterSchema>>

interface CreateCharacterPayload {
  /** Minimal character fields (server fills id, creatorId, ownerId, timestamps). */
  character: {
    version: string
    coverUrl: string
    characterId: string
  }
  name: string
  description: string
}

interface UpdateCharacterPayload {
  version?: string
  coverUrl?: string
  characterId?: string
}

// ---------------------------------------------------------------------------
// Mock remote "database" (in-memory, shared across store instances in the
// same module scope — simulates a real server that persists data).
// ---------------------------------------------------------------------------

const remoteDb = new Map<string, Character>()

/** Seed the mock remote with sample characters so the store isn't empty. */
function seedRemoteDb(): void {
  if (remoteDb.size > 0)
    return
  const samples: Character[] = [
    {
      id: 'char-001',
      version: '1.0.0',
      coverUrl: 'https://picsum.photos/seed/airi1/400/300',
      characterId: 'airi-default',
      name: 'Airi',
      description: 'The default AIRI character.',
      creatorId: 'sys',
      ownerId: 'sys',
      likesCount: 42,
      bookmarksCount: 7,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-06-01'),
      likes: [],
      bookmarks: [],
    },
    {
      id: 'char-002',
      version: '1.0.0',
      coverUrl: 'https://picsum.photos/seed/airi2/400/300',
      characterId: 'neko-chan',
      name: 'Neko-chan',
      description: 'A curious cat-girl character.',
      creatorId: 'user-1',
      ownerId: 'user-1',
      likesCount: 13,
      bookmarksCount: 3,
      createdAt: new Date('2024-03-15'),
      updatedAt: new Date('2024-07-20'),
      likes: [],
      bookmarks: [],
    },
  ]
  for (const c of samples) remoteDb.set(c.id, c)
}

seedRemoteDb()

// ---------------------------------------------------------------------------
// Mock service (simulates network calls with configurable delay)
// ---------------------------------------------------------------------------

/** Milliseconds to wait before resolving mock remote calls. */
const MOCK_DELAY_MS = 300

function delay(ms = MOCK_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cloneCharacter(c: Character): Character {
  return structuredClone(c)
}

async function mockFetchRemote(_params: { all?: boolean }): Promise<Character[]> {
  await delay()
  return Array.from(remoteDb.values()).map(cloneCharacter)
}

async function mockFetchRemoteById(id: string): Promise<Character> {
  await delay()
  const found = remoteDb.get(id)
  if (!found)
    throw new Error(`Character ${id} not found`)
  return cloneCharacter(found)
}

async function mockCreateRemote(
  userId: string,
  payload: CreateCharacterPayload,
): Promise<Character> {
  await delay()
  const now = new Date()
  const character: Character = {
    id: nanoid(),
    version: payload.character.version,
    coverUrl: payload.character.coverUrl,
    characterId: payload.character.characterId,
    name: payload.name,
    description: payload.description,
    creatorId: userId,
    ownerId: userId,
    likesCount: 0,
    bookmarksCount: 0,
    createdAt: now,
    updatedAt: now,
    likes: [],
    bookmarks: [],
  }
  remoteDb.set(character.id, character)
  return cloneCharacter(character)
}

async function mockUpdateRemote(
  id: string,
  payload: UpdateCharacterPayload,
): Promise<Character> {
  await delay()
  const existing = remoteDb.get(id)
  if (!existing)
    throw new Error(`Character ${id} not found`)
  const updated: Character = {
    ...existing,
    ...(payload.version !== undefined ? { version: payload.version } : {}),
    ...(payload.coverUrl !== undefined ? { coverUrl: payload.coverUrl } : {}),
    ...(payload.characterId !== undefined ? { characterId: payload.characterId } : {}),
    updatedAt: new Date(),
  }
  remoteDb.set(id, updated)
  return cloneCharacter(updated)
}

async function mockRemoveRemote(id: string): Promise<void> {
  await delay()
  remoteDb.delete(id)
}

async function mockLikeRemote(
  userId: string,
  id: string,
): Promise<Character> {
  await delay()
  const existing = remoteDb.get(id)
  if (!existing)
    throw new Error(`Character ${id} not found`)
  if (!existing.likes.some(l => l.userId === userId)) {
    existing.likes = [...existing.likes, { userId, characterId: id }]
    existing.likesCount += 1
  }
  remoteDb.set(id, existing)
  return cloneCharacter(existing)
}

async function mockBookmarkRemote(
  userId: string,
  id: string,
): Promise<Character> {
  await delay()
  const existing = remoteDb.get(id)
  if (!existing)
    throw new Error(`Character ${id} not found`)
  if (!existing.bookmarks.some(b => b.userId === userId)) {
    existing.bookmarks = [...existing.bookmarks, { userId, characterId: id }]
    existing.bookmarksCount += 1
  }
  remoteDb.set(id, existing)
  return cloneCharacter(existing)
}

// ---------------------------------------------------------------------------
// In-memory model (replaces unstorage-based charactersModel)
// ---------------------------------------------------------------------------

const localDb = new Map<string, Character>()

async function modelList(): Promise<Character[]> {
  return Array.from(localDb.values()).map(cloneCharacter)
}

async function modelSaveAll(characters: Character[]): Promise<void> {
  localDb.clear()
  for (const c of characters) localDb.set(c.id, cloneCharacter(c))
}

async function modelUpsert(character: Character): Promise<void> {
  localDb.set(character.id, cloneCharacter(character))
}

async function modelRemove(id: string): Promise<void> {
  localDb.delete(id)
}

// ---------------------------------------------------------------------------
// Controller helpers
// ---------------------------------------------------------------------------

function setCharactersMap(target: Map<string, Character>, characters: Character[]): void {
  target.clear()
  for (const c of characters) target.set(c.id, c)
}

/**
 * Core character controller — the same shape as `createCharacterStoreController`
 * from the production store but wired to mock service & in-memory model.
 *
 * Use when:
 * - You need a drop-in replacement for the controller in tests or prototypes.
 *
 * Expects:
 * - `userId` identifies the current user for like/bookmark/create operations.
 *
 * Returns:
 * - Reactive state (`characters`, `isLoading`, `error`, `mutationError`) and
 *   async operations (`fetchList`, `fetchById`, `create`, `update`, `remove`,
 *   `like`, `bookmark`, `getCharacter`).
 */
function createMvpController(userId: string) {
  const characters = ref<Map<string, Character>>(new Map())
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const mutationError = ref<Error | null>(null)

  async function fetchList(_all = false): Promise<Character[]> {
    // 1. Load cached characters immediately
    const cached = await modelList()
    if (cached.length > 0)
      setCharactersMap(characters.value, cached)

    // 2. Fetch from remote and update both local cache and model
    isLoading.value = true
    error.value = null
    try {
      const remote = await mockFetchRemote({ all: _all })
      await modelSaveAll(remote)
      setCharactersMap(characters.value, remote)
      return remote
    }
    catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      return cached
    }
    finally {
      isLoading.value = false
    }
  }

  async function fetchById(id: string): Promise<Character | undefined> {
    // 1. Check memory map, fall back to model
    const cached
      = characters.value.get(id) ?? (await modelList()).find(c => c.id === id)
    if (cached)
      characters.value.set(cached.id, cached)

    // 2. Try remote
    try {
      const remote = await mockFetchRemoteById(id)
      characters.value.set(remote.id, remote)
      await modelUpsert(remote)
      return remote
    }
    catch {
      return cached
    }
  }

  async function create(payload: CreateCharacterPayload): Promise<Character> {
    mutationError.value = null
    // 1. Optimistic local character
    const localId = nanoid()
    const now = new Date()
    const localCharacter: Character = {
      id: localId,
      version: payload.character.version,
      coverUrl: payload.character.coverUrl,
      characterId: payload.character.characterId,
      name: payload.name,
      description: payload.description,
      creatorId: userId,
      ownerId: userId,
      likesCount: 0,
      bookmarksCount: 0,
      createdAt: now,
      updatedAt: now,
      likes: [],
      bookmarks: [],
    }
    characters.value.set(localId, localCharacter)
    await modelUpsert(localCharacter)

    // 2. Sync to remote
    try {
      const remote = await mockCreateRemote(userId, payload)
      // Replace optimistic entry with server-authoritative one
      characters.value.delete(localId)
      await modelRemove(localId)
      characters.value.set(remote.id, remote)
      await modelUpsert(remote)
      return remote
    }
    catch (e) {
      mutationError.value = e instanceof Error ? e : new Error(String(e))
      return localCharacter
    }
  }

  async function update(
    id: string,
    payload: UpdateCharacterPayload,
  ): Promise<Character | undefined> {
    mutationError.value = null
    const existing = characters.value.get(id)
    if (!existing)
      return undefined

    // 1. Optimistic merge
    const optimistic: Character = {
      ...existing,
      ...(payload.version !== undefined ? { version: payload.version } : {}),
      ...(payload.coverUrl !== undefined ? { coverUrl: payload.coverUrl } : {}),
      ...(payload.characterId !== undefined ? { characterId: payload.characterId } : {}),
      updatedAt: new Date(),
    }
    characters.value.set(id, optimistic)
    await modelUpsert(optimistic)

    // 2. Sync to remote
    try {
      const remote = await mockUpdateRemote(id, payload)
      characters.value.set(id, remote)
      await modelUpsert(remote)
      return remote
    }
    catch (e) {
      mutationError.value = e instanceof Error ? e : new Error(String(e))
      return optimistic
    }
  }

  async function remove(id: string): Promise<void> {
    mutationError.value = null
    // 1. Optimistic removal
    characters.value.delete(id)
    await modelRemove(id)

    // 2. Sync to remote (fire-and-forget on failure — local state stays removed)
    try {
      await mockRemoveRemote(id)
    }
    catch (e) {
      mutationError.value = e instanceof Error ? e : new Error(String(e))
    }
  }

  async function like(id: string): Promise<void> {
    mutationError.value = null
    const existing = characters.value.get(id)
    if (!existing)
      return

    // 1. Optimistic like (only add, never remove — matches production behavior)
    if (!existing.likes.some(l => l.userId === userId)) {
      const optimistic: Character = {
        ...existing,
        likes: [...existing.likes, { userId, characterId: id }],
        likesCount: existing.likesCount + 1,
        updatedAt: new Date(),
      }
      characters.value.set(id, optimistic)
      await modelUpsert(optimistic)
    }

    // 2. Sync to remote
    try {
      const remote = await mockLikeRemote(userId, id)
      characters.value.set(id, remote)
      await modelUpsert(remote)
    }
    catch (e) {
      mutationError.value = e instanceof Error ? e : new Error(String(e))
    }
  }

  async function bookmark(id: string): Promise<void> {
    mutationError.value = null
    const existing = characters.value.get(id)
    if (!existing)
      return

    // 1. Optimistic bookmark (only add, never remove)
    if (!existing.bookmarks.some(b => b.userId === userId)) {
      const optimistic: Character = {
        ...existing,
        bookmarks: [...existing.bookmarks, { userId, characterId: id }],
        bookmarksCount: existing.bookmarksCount + 1,
        updatedAt: new Date(),
      }
      characters.value.set(id, optimistic)
      await modelUpsert(optimistic)
    }

    // 2. Sync to remote
    try {
      const remote = await mockBookmarkRemote(userId, id)
      characters.value.set(id, remote)
      await modelUpsert(remote)
    }
    catch (e) {
      mutationError.value = e instanceof Error ? e : new Error(String(e))
    }
  }

  function getCharacter(id: string): Character | undefined {
    return characters.value.get(id)
  }

  return {
    characters,
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    mutationError: computed(() => mutationError.value),

    fetchList,
    fetchById,
    create,
    update,
    remove,
    like,
    bookmark,
    getCharacter,
  }
}

// ---------------------------------------------------------------------------
// Pinia store
// ---------------------------------------------------------------------------

/**
 * MVP character store — drop-in replacement for `useCharacterStore`.
 *
 * Uses an in-memory model and mock remote service so no backend is required.
 *
 * Use when:
 * - Developing character UI without a running server
 * - Writing tests that exercise the local-first optimistic-update pattern
 *
 * Expects:
 * - `userId` option to identify the current user
 *
 * Returns:
 * - A Pinia store instance with reactive character state and CRUD operations
 *
 * Call stack:
 *
 * useCharacterStoreMvp
 *   -> createMvpController
 *     -> mockFetchRemote / mockCreateRemote / ...  (mock service)
 *     -> modelList / modelSaveAll / ...            (in-memory model)
 */
export const useCharacterStoreMvp = defineStore('characters-mvp', () => {
  // In production this comes from useAuthStore().userId
  const userId = 'mvp-user'

  return createMvpController(userId)
})
