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

    // 为每个键发起 get 请求，返回 Promise 数组
    const promises = keys.map((key: IDBValidKey) => {
      return new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result as unknown) // 键不存在时 result 为 undefined
        request.onerror = () => reject(new Error(`Failed to get key "${key}": ${request.error?.message}`))
      })
    })

    // 并行执行所有读取，结果顺序与 keys 一致
    return await Promise.all(promises)
  }
  finally {
    db.close() // 确保数据库连接被关闭
  }
}
