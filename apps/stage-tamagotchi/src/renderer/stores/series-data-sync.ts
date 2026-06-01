/**
 * Broadcast Channel Messaging API for Provider-Consumer State Synchronization
 *
 * This module provides a robust messaging protocol over the Web BroadcastChannel API.
 * It handles state synchronization between a single provider and multiple consumers,
 * with support for partial updates, acknowledgments, retries, and error handling.
 *
 * The protocol ensures eventual consistency even with message replays or losses.
 *
 * @module BroadcastChannelSync
 */

import { nanoid } from 'nanoid'

/** Message type identifiers */
export const messageTypes = {
  SYNC: 'sync',
  ACK: 'ack',
  REQUEST_UPDATE: 'request-update',
} as const

export type MessageType = typeof messageTypes[keyof typeof messageTypes]

/** Base message structure */
interface BaseMessage {
  type: MessageType
}

/**
 * Sync message - sent from provider to consumers to publish state updates
 */
export interface Sync<T = unknown> extends BaseMessage {
  type: typeof messageTypes.SYNC
  /**
   * Provider-scoped message sequence number,
   * MUST be monotonic during entire lifecycle of the provider.
   */
  seq: number
  /**
   * Identifier of the provider,
   * MUST be unique during entire lifecycle of the broadcast channel.
   */
  providerId: string
  /** The record payload (may be empty) */
  payload: T[]
  /** Status: "OK", "READY", "NOT_READY", or "ERROR:..." */
  status: string
  /** Oldest record index in the payload (inclusive) */
  updateFrom: number
  /** Latest record index in the payload (inclusive) */
  updateTo: number
  /**
   * Change version of the current record list.
   * Provider MUST bump the version number when a change is applied.
   */
  version: number
  /** Optional request ID this sync responds to (for consumer requests) */
  requestId?: string
}

/**
 * Ack message - sent from consumer to acknowledge receipt of a sync message
 */
export interface Ack extends BaseMessage {
  type: typeof messageTypes.ACK
  /** Unique identifier of the consumer */
  consumerId: string
  /** Status: "OK" or "BYE" */
  status: string
  /** Sequence number of the sync message being acknowledged (optional for BYE) */
  seq?: number
}

/**
 * Request-Update message - sent from consumer to request state updates
 */
export interface RequestUpdate extends BaseMessage {
  type: typeof messageTypes.REQUEST_UPDATE
  /** Unique identifier of the consumer */
  consumerId: string
  /** Unique request ID to match responses */
  requestId: string
  /** Inclusive starting sequence number */
  updateSince: number
}

/** Union of all message types */
export type Message<T = unknown> = Sync<T> | Ack | RequestUpdate

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Configuration options for Provider */
export interface ProviderOptions {
  /** Timeout in ms waiting for ack before retry (default: 25) */
  ackTimeoutMs?: number
  /** Maximum number of ack retries per consumer (default: 3) */
  maxAckRetries?: number
}

/** Consumer registration entry for provider */
interface ConsumerEntry {
  consumerId: string
  /** Last successfully acknowledged sync sequence number */
  lastAck: number | null
  /** Pending sync message waiting for ack */
  pendingSync: {
    message: Sync
    retries: number
    timeoutHandle: ReturnType<typeof setTimeout>
  } | null
}

/**
 * Provider - Manages state and broadcasts sync messages to all consumers.
 *
 * There must be at most ONE provider per broadcast channel. The provider
 * holds the full authoritative record list and is responsible for sending
 * sync messages on updates and responding to consumer request-update messages.
 *
 * @example
 * ```typescript
 * const provider = new Provider('my-channel', 'provider-1', [{ id: 1, name: 'Item 1' }]);
 * provider.start();
 *
 * // Later, update records
 * provider.setRecords([{ id: 1, name: 'Updated Item' }, { id: 2, name: 'Item 2' }]);
 *
 * // Or use incremental updates
 * provider.publishUpdate(1, [{ id: 2, name: 'Item 2' }], 1);
 * ```
 */
export class Provider<T = unknown> {
  private channel: BroadcastChannel
  private consumers: Map<string, ConsumerEntry> = new Map()
  private nextSeq: number = 1
  private records: T[] = []
  private readonly ackTimeoutMs: number
  private readonly maxAckRetries: number
  private started: boolean = false
  private version: number = 0

  /**
   * Creates a new Provider instance.
   * @param channelName - Name of the BroadcastChannel to use
   * @param providerId - Unique identifier for this provider
   * @param initialRecords - Initial record list (default: empty)
   * @param options - Configuration options
   */
  constructor(
    private readonly channelName: string,
    private readonly providerId: string,
    initialRecords: T[] = [],
    options: ProviderOptions = {},
  ) {
    this.records = [...initialRecords]
    this.ackTimeoutMs = options.ackTimeoutMs ?? 25 // for IPC calls, 25ms is really slow
    this.maxAckRetries = options.maxAckRetries ?? 3
    this.channel = new BroadcastChannel(channelName)
  }

  /**
   * Starts the provider: opens the broadcast channel, sets up message listener,
   * and broadcasts a READY signal to all consumers.
   */
  start(): void {
    if (this.started) {
      console.warn(
        'Sync provider already started',
        { channel: this.channelName, provider: this.providerId },
      )
      return
    }
    this.started = true
    this.channel.onmessage = ev => this.handleMessage(ev)
    this.sendReady()
    console.info(`Sync provider started.`, { channel: this.channelName, provider: this.providerId })
  }

  /**
   * Stops the provider and closes the broadcast channel.
   */
  stop(): void {
    if (!this.started)
      return
    this.started = false
    this.channel.onmessage = null
    this.channel.close()
    // Clear all pending timeouts
    for (const entry of this.consumers.values()) {
      if (entry.pendingSync) {
        clearTimeout(entry.pendingSync.timeoutHandle)
      }
    }
    this.consumers.clear()
    console.info(`Sync provider stopped.`, { channel: this.channelName, provider: this.providerId })
  }

  /**
   * Sets the full record list and broadcasts the minimal changed range.
   * Compares with existing records and sends a sync message from the first
   * changed index to the end, handling insertions, deletions, and updates.
   * If there is no change, the function returns immediately without bumping
   * version or broadcasting changes.
   *
   * @param newRecords - The complete new record array
   */
  setRecords(newRecords: T[]): void {
    const oldRecords = this.records
    let firstDiff = 0
    const minLen = Math.min(oldRecords.length, newRecords.length)
    while (firstDiff < minLen && oldRecords[firstDiff] === newRecords[firstDiff]) {
      firstDiff++
    }
    if (firstDiff === oldRecords.length && firstDiff === newRecords.length)
      return // no changes
    const payload = newRecords.slice(firstDiff)
    const updateTo = newRecords.length - 1
    this.publishUpdate(firstDiff, payload, updateTo)
  }

  /**
   * Publishes an incremental update to all consumers.
   * Use this when you know exactly which range changed.
   * Direct call to this function bumps version number by 1,
   * and broadcast a `sync` message even when no modification is made.
   *
   * @param updateFrom - Starting index of the change (inclusive)
   * @param payload - The new records from updateFrom onward
   * @param updateTo - New last index after the update
   *
   * @throws Error - Throw when updateFrom and updateTo are invalid, e.g from > to, from < 0, from > current length(gap).
   */
  publishUpdate(updateFrom: number, payload: T[], updateTo: number, consumer?: { consumerId: string, requestId: string }): void {
    if (updateFrom > updateTo || updateFrom < 0 || updateTo - updateFrom < payload.length)
      throw new Error('Invalid update range')
    if (updateFrom > this.records.length)
      throw new Error('Gap between existing record and records to update')
    this.records.splice(updateFrom, this.records.length - updateFrom, ...payload)
    this.version += 1
    const syncMsg = this.createSyncMessage(updateFrom, payload, updateTo, this.version, consumer?.requestId)
    this.sendSyncMessage(syncMsg, consumer ? [consumer.consumerId] : undefined)
  }

  /**
   * Sends the initial READY signal to all consumers.
   * This sync message has empty payload, from/to = 0, status = "READY".
   */
  private sendReady(): void {
    const syncMsg = this.createSyncMessage(0, [], 0, 0, undefined, 'READY')
    this.sendSyncMessage(syncMsg) // track `ack` for "READY" to force a full update on all consumers
  }

  /**
   * Creates a sync message object.
   */
  private createSyncMessage(
    updateFrom: number,
    payload: T[],
    updateTo: number,
    version: number,
    requestId?: string,
    status: string = 'OK',
  ): Sync<T> {
    return {
      type: messageTypes.SYNC,
      seq: this.nextSeq++,
      providerId: this.providerId,
      payload,
      version,
      status,
      updateFrom,
      updateTo,
      requestId,
    }
  }

  /**
   * Dispatches a sync message to the channel and sets up ack tracking for the provided consumers.
   *
   * @param syncMsg The message to send
   * @param target Optional, the consumers to set up ACK tracking.
   *  Null/undefined for ALL consumers(broadcast), empty array for no consumer.
   */
  private sendSyncMessage(syncMsg: Sync<T>, target?: string[]): void {
    for (const consumerId of target ?? this.consumers.keys()) {
      if (!this.consumers.has(consumerId))
        continue
      const entry = this.consumers.get(consumerId)!
      clearTimeout(entry.pendingSync?.timeoutHandle)
      const timeoutHandle = setTimeout(() => {
        this.handleAckTimeout(consumerId, syncMsg)
      }, this.ackTimeoutMs)
      entry.pendingSync = {
        message: syncMsg,
        retries: 0,
        timeoutHandle,
      }
    }
    this.channel.postMessage(syncMsg)
  }

  private handleAckTimeout(consumerId: string, syncMsg: Sync<T>): void {
    const entry = this.consumers.get(consumerId)
    if (!entry || !entry.pendingSync || entry.pendingSync.message.seq !== syncMsg.seq) {
      return // Already acknowledged or replaced
    }
    const retries = entry.pendingSync.retries
    if (retries < this.maxAckRetries) {
      console.warn(
        `Ack timeout for consumer ${consumerId}. seq=${syncMsg.seq}, retry ${retries + 1}/${this.maxAckRetries}`,
        { channelName: this.channelName, provider: this.providerId },
      )
      entry.pendingSync.retries++
      return this.sendSyncMessage(syncMsg, [entry.consumerId])
    }
    console.warn(
      `Sync consumer ${consumerId} failed to ack after ${this.maxAckRetries} retries, unregistering`,
      { channelName: this.channelName, provider: this.providerId },
    )
    this.unregisterConsumer(consumerId)
  }

  private handleMessage(event: MessageEvent<Message<T>>): void {
    const message = event.data
    switch (message.type) {
      case messageTypes.REQUEST_UPDATE:
        this.handleRequest(message)
        break
      case messageTypes.ACK:
        this.handleAck(message)
        break
    // Ignore other types (e.g., sync messages from other providers - should not happen)
    }
  }

  /**
   * Respond a update request from a consumer.
   * When the provider successfully handled the request, it MUST respond with status "OK".
   * If the provider is not ready, it MUST respond with status "NOT_READY".
   * If the provider errored when processing request, it MUST respond with status "ERROR".
   * @param request The update request to handle.
   */
  private handleRequest(request: RequestUpdate): void {
    const { consumerId, requestId, updateSince } = request
    // register or update consumer
    if (!this.consumers.has(consumerId)) {
      this.consumers.set(consumerId, {
        consumerId,
        lastAck: null,
        pendingSync: null,
      })
      console.info(
        `Sync consumer ${consumerId} registered on first request.`,
        { channelName: this.channelName, provider: this.providerId },
      )
    }

    // Determine payload based on updateSince
    let payload: T[] = []
    let updateFrom = updateSince
    const updateTo = this.records.length - 1 // always respond with record [updateSince..end]
    const status = 'OK'

    if (updateFrom > updateTo) {
      // Requested index beyond current records(record after updateSince are deleted)
      // send empty with latest index
      updateFrom = this.records.length - 1
    }
    if (updateFrom <= updateTo) {
      payload = this.records.slice(updateSince)
    }

    const syncMsg = this.createSyncMessage(
      updateFrom,
      payload,
      updateTo,
      this.version,
      requestId,
      status,
    )
    this.sendSyncMessage(syncMsg, [consumerId])
  }

  /**
   * Handles an ack message from a consumer.
   */
  private handleAck(ack: Ack): void {
    const { consumerId, status, seq } = ack
    const entry = this.consumers.get(consumerId)

    if (!entry) {
      return console.warn(
        `Sync provider received ack from unknown consumer ${consumerId}`,
        { channelName: this.channelName, provider: this.providerId },
      )
    }

    if (status === 'BYE')
      return this.unregisterConsumer(consumerId)
    if (status === 'OK' && seq !== undefined) {
      entry.lastAck = seq
      if (entry.pendingSync && entry.pendingSync.message.seq === seq) {
        clearTimeout(entry.pendingSync.timeoutHandle)
        entry.pendingSync = null
      }
    }
  }

  /**
   * Unregisters a consumer.
   * @param consumerId - the consumer ID to unregister
   */
  private unregisterConsumer(consumerId: string): void {
    const entry = this.consumers.get(consumerId)
    if (entry && entry.pendingSync) {
      clearTimeout(entry.pendingSync.timeoutHandle)
    }
    this.consumers.delete(consumerId)
    console.info(
      `Sync consumer ${consumerId} unregistered .`,
      { channelName: this.channelName, provider: this.providerId },
    )
  }

  /** Get the full record list. */
  getRecords(): T[] {
    return [...this.records]
  }
}

/**
 * Configuration options for the Consumer
 */
export interface ConsumerOptions {
  /** Timeout in ms waiting for a sync response (default: 10000) */
  requestTimeoutMs?: number
  /** Maximum number of retries for failed requests (default: 3) */
  maxRetries?: number
}

/**
 * Pending request entry
 */
interface PendingRequest {
  requestId: string
  updateSince: number
  retries: number
  timeoutHandle: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (e: Error) => void
}

/**
 * Consumer - Receives state updates from the provider.
 *
 * The consumer sends request-update messages to the provider and applies
 * received sync messages to maintain its local record list. It handles
 * timeouts, retries, gap detection, and graceful unsubscription.
 *
 * @example
 * ```typescript
 * const consumer = new Consumer('my-channel', 'consumer-1');
 * consumer.onUpdate((records) => {
 *   console.log('Received update:', records);
 * });
 * await consumer.start();
 *
 * // Later
 * consumer.stop();
 * ```
 */
export class Consumer<T = unknown> {
  private channel: BroadcastChannel
  private records: T[] = []
  private pendingRequest: PendingRequest | null = null
  private version: number = 0
  private isStarted: boolean = false
  private updateCallback?: (records: T[]) => void
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number

  /**
   * Creates a new Consumer instance.
   * @param channelName - Name of the BroadcastChannel to use (must match provider)
   * @param consumerId - Unique identifier for this consumer
   * @param options - Configuration options
   */
  constructor(
    private readonly channelName: string,
    private readonly consumerId: string,
    options: ConsumerOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000
    this.maxRetries = options.maxRetries ?? 3
    this.channel = new BroadcastChannel(channelName)
  }

  /**
   * Registers a callback to be invoked whenever the local record list changes.
   * @param callback - Function called with the updated record array
   */
  onUpdate(callback: (records: T[]) => void): void {
    this.updateCallback = callback
  }

  /**
   * Starts the consumer: opens the channel, sets up message listener,
   * and sends an initial request-update (updateSince=0) for full sync.
   */
  async start(): Promise<void> {
    if (this.isStarted)
      return
    this.isStarted = true
    this.channel.onmessage = ev => this.handleMessage(ev)
    await this.requestUpdate(0) // full sync on startup
    console.info(
      `Consumer started.`,
      { channelName: this.channelName, consumerId: this.consumerId },
    )
  }

  /**
   * Stops the consumer: sends BYE ack, clears pending requests, and closes the channel.
   */
  stop(): void {
    if (!this.isStarted)
      return
    const byeAck: Ack = {
      type: messageTypes.ACK,
      consumerId: this.consumerId,
      status: 'BYE',
    }
    this.channel.postMessage(byeAck)

    this.isStarted = false
    this.channel.onmessage = null
    this.channel.close()

    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeoutHandle)
      this.pendingRequest = null
    }

    console.info(`Consumer Stopped`, { channelName: this.channelName, consumerId: this.consumerId })
  }

  /**
   * Sends a request-update message to the provider, cancels any request in-flight.
   * @param updateSince - Starting index (inclusive) for partial update
   * @returns Promise that resolves when the request is completed or rejected after retries
   */
  private async requestUpdate(updateSince: number): Promise<void> {
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeoutHandle)
      this.pendingRequest = null
    }

    const requestId = nanoid()
    const retries = 0

    const attemptRequest = async (): Promise<void> => {
      const requestMsg: RequestUpdate = {
        type: messageTypes.REQUEST_UPDATE,
        consumerId: this.consumerId,
        requestId,
        updateSince,
      }
      this.channel.postMessage(requestMsg)
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          if (this.pendingRequest?.requestId === requestId) {
            this.pendingRequest = null
            reject(new Error(`Request timeout for updateSince=${updateSince}`))
          }
        }, this.requestTimeoutMs)

        this.pendingRequest = {
          requestId,
          updateSince,
          retries,
          timeoutHandle,
          resolve,
          reject,
        }
      })
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await attemptRequest()
        return
      }
      catch (error) {
        console.warn(
          `Consumer request attempt ${attempt + 1} failed:`,
          error,
          { channelName: this.channelName, consumerId: this.consumerId },
        )
        if (attempt < this.maxRetries) {
          await delay(this.requestTimeoutMs * (attempt + 1))
        }
      }
    }

    console.error(
      `All ${this.maxRetries + 1} request attempts failed for updateSince=${updateSince}`,
      { channelName: this.channelName, consumerId: this.consumerId },
    )
    this.pendingRequest = null
  }

  /**
   * Handles incoming sync messages from the provider.
   */
  private handleMessage(event: MessageEvent<Message<T>>): void {
    const message = event.data

    if (message.type !== messageTypes.SYNC)
      return

    const sync = message as Sync<T>
    this.handleSync(sync)
  }

  /**
   * Processes a sync message: applies state updates and sends ack.
   * A consumer MUST request a full update immediately upon seeing a "READY" status `sync` message.
   */
  private handleSync(sync: Sync<T>): void {
    const { status, requestId, seq, updateFrom, updateTo, payload, version } = sync

    if (status === 'READY') {
      // acknowledge the ready message and request a full sync
      this.sendAck(seq)
      this.requestUpdate(0).catch(console.error)
      return
    }

    if (requestId && this.pendingRequest && this.pendingRequest.requestId === requestId) {
      clearTimeout(this.pendingRequest.timeoutHandle)
      const resolve = this.pendingRequest.resolve
      const reject = this.pendingRequest.reject
      if (status === 'OK') {
        this.applySyncPayload(updateFrom, payload, updateTo, version)
        this.sendAck(seq)
        resolve()
        return
      }
      if (status === 'NOT_READY' || status.startsWith('ERROR')) {
        this.handleFailedRequest(status, this.pendingRequest?.updateSince ?? 0)
        if (reject)
          reject(new Error(`Provider status: ${status}`))
        return
      }
      this.pendingRequest = null
    }
  }

  /**
   * Handles a failed request (NOT_READY or ERROR status).
   */
  private handleFailedRequest(status: string, originalUpdateSince: number): void {
    // Increment requestId implicitly by calling requestUpdate again
    // But we need to track retries
    // Simplified: retry with same updateSince up to maxRetries, then give up
    // We'll use the consumer's retry mechanism via requestUpdate with backoff
    console.info(
      `Provider returned ${status}, retrying request.`,
      { channelName: this.channelName, consumer: this.consumerId },
    )
    this.requestUpdate(originalUpdateSince).catch((err) => {
      console.error(`Retry failed:`, err, { channelName: this.channelName, consumerId: this.consumerId })
    })
  }

  /**
   * Applies the payload from a sync message to the local record list.
   * Handles gaps, truncations, and empty payloads.
   */
  private applySyncPayload(updateFrom: number, payload: T[], updateTo: number, version: number): void {
    if (version !== this.version + 1) { // not latest version before update, don't apply and request full update
      this.requestUpdate(0).catch(console.error)
      return
    }
    this.version = version
    if (payload.length === 0)
      return // no changes made

    // Apply the payload: replace range [updateFrom, updateTo] with payload
    const newRecords = [...this.records]

    // Replace from updateFrom with payload
    newRecords.splice(updateFrom, payload.length, ...payload)

    // Truncate if updateTo is shorter than new array length
    if (updateTo + 1 < newRecords.length) {
      newRecords.length = updateTo + 1
    }

    this.records = newRecords

    if (this.updateCallback) {
      this.updateCallback([...this.records])
    }
  }

  /**
   * Sends an acknowledgment for a received sync message.
   */
  private sendAck(seq: number): void {
    const ack: Ack = {
      type: messageTypes.ACK,
      consumerId: this.consumerId,
      status: 'OK',
      seq,
    }
    this.channel.postMessage(ack)
  }

  /**
   * Returns the current local record list.
   */
  getRecords(): T[] {
    return [...this.records]
  }
}
