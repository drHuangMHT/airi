/**
 * Get all keys in an IndexedDB that matches the specified prefix.
 * @param {string} dbName Name of the database
 * @param {string} storeName Name of the store
 * @param {string} prefix Prefix to filter
 * @returns {Promise<string[]>} All keys that matches the prefix, including the key of prefix itself
 * @throws {Error} When IndexedDB is not supported or the database/store does not exist
 */
export async function getKeysWithPrefix(dbName: string, storeName: string, prefix: string): Promise<IDBValidKey[]> {
  if (!window.indexedDB) {
    throw new Error('IndexedDB is not supported in this browser')
  }

  const openDB = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onerror = () => reject(new Error(`Failed to open database: ${request.error!.message}`))
    request.onsuccess = () => resolve(request.result)
  })

  let db: IDBDatabase | null = null
  try {
    db = await openDB()

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`Object store '${storeName}' does not exist in database '${dbName}'`)
    }

    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)

    const range = IDBKeyRange.bound(prefix, `${prefix}\uFFFF`, false, false)

    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = store.getAllKeys(range)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error(`Failed to get keys: ${request.error!.message}`))
      transaction.onerror = () => reject(new Error(`Transaction error: ${transaction.error!.message}`))
    })

    db.close()
    return keys
  }
  catch (error) {
    if (db)
      db.close()
    throw error
  }
}

/**
 * Batched get value from IndexedDB
 * @param {string} dbName Name of the database
 * @param {string} storeName Name of the store
 * @param {Array} keys Array of keys to read
 * @returns {Promise<unknown[]>} Values in the order of the given keys. `undefined` if key is not present.
 * @throws {Error} When IndexedDB is not supported or the database/store does not exist
 */
export async function getValues(dbName: string, storeName: string, keys: IDBValidKey[]): Promise<unknown[]> {
  if (!window.indexedDB) {
    throw new Error('IndexedDB is not supported in this environment')
  }

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(`Failed to open database: ${request.error?.message}`))
  })

  try {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)

    const promises = keys.map((key: IDBValidKey) => {
      return new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result as unknown) // 键不存在时 result 为 undefined
        request.onerror = () => reject(new Error(`Failed to get key "${key}": ${request.error?.message}`))
      })
    })
    return await Promise.all(promises)
  }
  finally {
    db.close()
  }
}

/**
 * Deletes a key from an IndexedDB object store.
 * @param dbName - Name of the database.
 * @param storeName - Name of the object store.
 * @param key - The key to delete (must be a valid IndexedDB key).
 * @returns `true` if the key existed and was successfully deleted, otherwise `false`.
 */
export async function deleteIndexedDBKey(
  dbName: string,
  storeName: string,
  key: IDBValidKey,
): Promise<boolean> {
  // Check if the database exists (avoid auto-creating a new database)
  let dbExists = false
  try {
    const databases = await indexedDB.databases()
    dbExists = databases.some(db => db.name === dbName)
  }
  catch {
    // If indexedDB.databases() fails (unlikely in modern browsers), fall back to safe open
    return false
  }
  if (!dbExists)
    return false

  // Helper to open the existing database
  const openDB = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      // If an upgrade is triggered (should not happen for existing DB without version change), reject
      request.onupgradeneeded = () => reject(new Error('Unexpected upgrade needed'))
    })

  let db: IDBDatabase | null = null
  try {
    db = await openDB()

    // Verify the object store exists
    if (!db.objectStoreNames.contains(storeName))
      return false

    // Perform get + delete inside a readwrite transaction
    const deleted = await new Promise<boolean>((resolve, reject) => {
      const transaction = db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const getRequest = store.get(key)

      getRequest.onsuccess = () => {
        const exists = getRequest.result !== undefined
        if (!exists) {
          resolve(false)
          return
        }
        const deleteRequest = store.delete(key)
        deleteRequest.onsuccess = () => resolve(true)
        deleteRequest.onerror = () => reject(deleteRequest.error)
      }
      getRequest.onerror = () => reject(getRequest.error)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(new Error('Transaction aborted'))
    })

    return deleted
  }
  catch {
    // Any error (DB open fails, store missing, transaction failure, etc.) returns false
    return false
  }
  finally {
    db?.close()
  }
}
