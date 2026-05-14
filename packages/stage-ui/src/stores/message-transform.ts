import type { ContextSnapshot } from './chat/context-prompt'

import { formatContextPromptText } from './chat/context-prompt'
import { formatTimePrefix } from './chat/datetime-prefix'

export enum SupportedContentType {
  AUDIO = 'input_audio',
  FILE = 'file',
  IMAGE = 'image_url',
  TEXT = 'text',
}

export interface ContentTypeMap {
  [SupportedContentType.AUDIO]: AudioContent
  [SupportedContentType.FILE]: FileContent
  [SupportedContentType.IMAGE]: ImageContent
  [SupportedContentType.TEXT]: TextContent
}

export type Content = { [K in SupportedContentType]: ContentTypeMap[K] }[SupportedContentType]

interface AudioContent {
  input_audio: {
    data: string
    format: 'mp3' | 'wav'
  }
  type: SupportedContentType.AUDIO
}

interface FileContent {
  file: {
    file_data?: string
    file_id?: string
    filename?: string
  }
  type: SupportedContentType.FILE
}
interface ImageContent {
  image_url: {
    detail?: 'auto' | 'high' | 'low'
    url: string
  }
  type: SupportedContentType.IMAGE
}
interface TextContent {
  text: string
  type: SupportedContentType.TEXT
}

export type MaybeMessage = Record<string, unknown> & { content: string, role?: string, createdAt?: number, id?: string }

export interface MessageTransformer {
  transform: (
    message: MaybeMessage,
    context: Record<string, unknown>,
  ) => Promise<{ message: MaybeMessage, context: Record<string, unknown> }>
}

export class Chained implements MessageTransformer {
  private transformerChain: MessageTransformer

  constructor(fn: MessageTransformer) {
    this.transformerChain = fn
  }

  then(next: MessageTransformer): Chained {
    const prevTransform = this.transformerChain
    return new Chained({ transform: async (message, context) => {
      const intermediate = await prevTransform.transform(message, context)
      return next.transform(intermediate.message, intermediate.context)
    } })
  }

  async transform(message: MaybeMessage, context: Record<string, unknown>): Promise<{ message: MaybeMessage, context: Record<string, unknown> }> {
    return this.transformerChain.transform(message, context)
  }
}

/**
 * insert a piece of text to a message's content at the given position.
 * position will be clamped to [0, content.length] automatically.
 * @param msg the message to insert text to.
 * @param text the text to insert.
 * @param position the position to insert the text to. 0 for prepend, nullish value for append.
 */
export function concatText(msg: MaybeMessage, text: string, position?: number): MaybeMessage {
  const safePosition = Math.min(Math.max(position ?? msg.content.length, 0), msg.content.length)
  const message = { ...msg }
  message.content = message.content.slice(0, safePosition) + text + msg.content.slice(safePosition)
  return message
}

export const timestampPrefixTransformer: MessageTransformer = {
  transform: async (message, context) => {
    if (message.role !== 'user')
      return { message, context }

    const now = (context.now as number) ?? Date.now()
    const createdAt = (message.createdAt as number) ?? now
    const prefix = formatTimePrefix(createdAt)

    return {
      message: concatText(message, prefix, 0),
      context: { ...context, timestampApplied: true },
    }
  },
}
export const contextPromptTransformer: MessageTransformer = {
  transform: async (message, context) => {
    if (message.role !== 'user' || !context.isLastUserMessage)
      return { message, context }
    if (!('contextSnapshot' in context))
      return { message, context }
    const contextsSnapshot = context.contextsSnapshot as ContextSnapshot
    const promptText = formatContextPromptText(contextsSnapshot)
    if (!promptText)
      return { message, context }
    return {
      message: concatText(message, promptText),
      context,
    }
  },
}
